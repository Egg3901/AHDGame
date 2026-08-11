export type TemplateFieldType = "text" | "textarea" | "markdown";

export interface TemplateField {
  id: string;
  label: string;
  placeholder: string;
  type: TemplateFieldType;
  required: boolean;
  order: number;
}

export interface WikiTemplate {
  _id: string; // template slug
  name: string;
  description: string;
  icon: string;
  fields: TemplateField[];
}
