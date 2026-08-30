import { useTheme } from "next-themes";
import { Toaster as Sonner, toast } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-card group-[.toaster]:text-foreground group-[.toaster]:border-border/80 group-[.toaster]:shadow-lg group-[.toaster]:rounded-xl group-[.toaster]:font-sans",
          description: "group-[.toast]:text-muted-foreground group-[.toast]:text-xs",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground group-[.toast]:font-medium group-[.toast]:text-xs group-[.toast]:rounded-lg",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground group-[.toast]:text-xs group-[.toast]:rounded-lg",
          error: "group-[.toaster]:border-danger/40 group-[.toaster]:bg-card group-[.toaster]:text-foreground group-[.toaster]:edge-light-rose",
          success: "group-[.toaster]:border-accent/40 group-[.toaster]:bg-card group-[.toaster]:text-foreground group-[.toaster]:edge-light-teal",
          warning: "group-[.toaster]:border-warn/40 group-[.toaster]:bg-card group-[.toaster]:text-foreground group-[.toaster]:edge-light-amber",
          info: "group-[.toaster]:border-info/40 group-[.toaster]:bg-card group-[.toaster]:text-foreground group-[.toaster]:edge-light-sky",
        },
      }}
      {...props}
    />
  );
};

export { Toaster, toast };
