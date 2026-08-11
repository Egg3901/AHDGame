export interface SystemTag {
  _id: string; // tag slug
  name: string;
  description: string;
  icon: string;
  color: string; // Tailwind class
  isSystem: true;
  order: number;
}
