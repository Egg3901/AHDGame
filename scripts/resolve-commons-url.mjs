const files = process.argv.slice(2);
for (const t of files) {
  const u = `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(t)}&prop=imageinfo&iiprop=url&iiurlwidth=1280&format=json`;
  const j = await (await fetch(u)).json();
  const p = Object.values(j.query.pages)[0];
  if (p.missing) {
    console.log("MISSING", t);
    continue;
  }
  console.log(p.imageinfo[0].thumburl || p.imageinfo[0].url);
}
