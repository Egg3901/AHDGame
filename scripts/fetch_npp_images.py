import os
import json
import random
import time
import requests
from pathlib import Path
from datetime import datetime

# Configuration
API_URL = "https://commons.wikimedia.org/w/api.php"
USER_AGENT = "AHouseDividedBot/1.0 (rainf@example.com) requests/2.31"
OUTPUT_FILE = Path("src/data/npp-images.json")
CACHE_DIR = Path("public/images/npp-cache")
TARGET_COUNT = 100
MIN_WIDTH = 200
MIN_HEIGHT = 200

# Search terms to get a good variety of politician-looking people
SEARCH_TERMS = [
    "Politicians of the United States",
    "Members of the United States House of Representatives",
    "United States Senators",
    "Governors of U.S. states",
    "State legislators of the United States"
]

def ensure_dirs():
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)

def search_commons_images(category, limit=50):
    """Search for images in a category."""
    params = {
        "action": "query",
        "format": "json",
        "list": "categorymembers",
        "cmtitle": f"Category:{category}",
        "cmtype": "file",
        "cmlimit": limit,
        "cmso": "random"  # Random sort order to get variety
    }
    
    try:
        response = requests.get(API_URL, params=params, headers={"User-Agent": USER_AGENT})
        response.raise_for_status()
        data = response.json()
        return data.get("query", {}).get("categorymembers", [])
    except Exception as e:
        print(f"Error searching category {category}: {e}")
        return []

def get_image_info(file_title):
    """Get detailed info for a file."""
    params = {
        "action": "query",
        "format": "json",
        "prop": "imageinfo",
        "titles": file_title,
        "iiprop": "url|size|extmetadata|mime",
        "iiurlwidth": 400  # Request a thumbnail URL around 400px width
    }
    
    try:
        response = requests.get(API_URL, params=params, headers={"User-Agent": USER_AGENT})
        response.raise_for_status()
        data = response.json()
        pages = data.get("query", {}).get("pages", {})
        page = next(iter(pages.values()))
        if "imageinfo" in page:
            return page["imageinfo"][0]
        return None
    except Exception as e:
        print(f"Error getting info for {file_title}: {e}")
        return None

def process_images():
    ensure_dirs()
    
    collected_images = []
    seen_urls = set()
    
    # Load existing if any
    if OUTPUT_FILE.exists():
        try:
            with open(OUTPUT_FILE, "r", encoding="utf-8") as f:
                existing = json.load(f)
                # If existing is a list, use it. If it's a dict with metadata, extract list
                if isinstance(existing, list):
                    collected_images = existing
                elif isinstance(existing, dict) and "images" in existing:
                    collected_images = existing["images"]
                
                for img in collected_images:
                    seen_urls.add(img["originalUrl"])
                print(f"Loaded {len(collected_images)} existing images.")
        except Exception as e:
            print(f"Error loading existing cache: {e}")

    # Search and fetch
    print("Fetching new images...")
    
    for term in SEARCH_TERMS:
        if len(collected_images) >= TARGET_COUNT:
            break
            
        print(f"Searching category: {term}")
        files = search_commons_images(term, limit=30)
        
        for file in files:
            if len(collected_images) >= TARGET_COUNT:
                break
                
            title = file["title"]
            if not title.lower().endswith(('.jpg', '.jpeg', '.png')):
                continue
                
            print(f"Processing {title}...")
            info = get_image_info(title)
            
            if not info:
                continue
                
            # Filter checks
            width = info.get("width", 0)
            height = info.get("height", 0)
            mime = info.get("mime", "")
            
            if width < MIN_WIDTH or height < MIN_HEIGHT:
                print(f"  Skipping: Too small ({width}x{height})")
                continue
                
            url = info.get("url")
            thumb_url = info.get("thumburl")
            
            if not url or url in seen_urls:
                print("  Skipping: Duplicate or no URL")
                continue
                
            # Metadata extraction
            meta = info.get("extmetadata", {})
            license_name = meta.get("LicenseShortName", {}).get("value", "Unknown")
            artist = meta.get("Artist", {}).get("value", "Unknown")
            description = meta.get("ImageDescription", {}).get("value", "")
            
            # Simple check for license (allow Public Domain, CC BY, CC BY-SA)
            # Exclude non-commercial or restrictive licenses if possible (Wikimedia usually is free)
            
            image_entry = {
                "id": str(len(collected_images) + 1),
                "title": title,
                "originalUrl": url,
                "thumbUrl": thumb_url,
                "width": width,
                "height": height,
                "license": license_name,
                "attribution": f"By {artist}",
                "description": description[:200] + "..." if len(description) > 200 else description,
                "source": "Wikimedia Commons",
                "fetchedAt": datetime.now().isoformat()
            }
            
            collected_images.append(image_entry)
            seen_urls.add(url)
            print(f"  Added! Total: {len(collected_images)}")
            
            # Be nice to the API
            time.sleep(0.5)
            
    # Save results
    output_data = {
        "lastUpdated": datetime.now().isoformat(),
        "count": len(collected_images),
        "images": collected_images
    }
    
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(output_data, f, indent=2)
        
    print(f"Done! Saved {len(collected_images)} images to {OUTPUT_FILE}")

if __name__ == "__main__":
    try:
        process_images()
    except KeyboardInterrupt:
        print("\nStopped by user.")
    except Exception as e:
        print(f"\nFatal error: {e}")
