interface FormAlertProps {
  tone: "error" | "success";
  children: React.ReactNode;
}

/** Form-level message announced to assistive technology. */
export function FormAlert({ tone, children }: FormAlertProps) {
  const styles =
    tone === "error" ? "border-brand-red/30 bg-brand-red/5 text-brand-red-dark" : "border-green-600/30 bg-green-50 text-green-800";
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`rounded-lg border px-4 py-3 text-sm ${styles}`}>
      {children}
    </div>
  );
}
