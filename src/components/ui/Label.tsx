"use client";

interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  children: React.ReactNode;
  required?: boolean;
}

export function Label({ children, className = "", required, ...props }: LabelProps) {
  return (
    <label className={`mb-2 block text-sm font-medium ${className}`.trim()} {...props}>
      {children}
      {required && <span className="text-red-500"> *</span>}
    </label>
  );
}
