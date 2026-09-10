import { useThemeStore } from "@/store/themeStore";
import { Toaster as Sonner, toast } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  // Use the app's own Zustand themeStore instead of next-themes (which is a
  // Next.js library and shouldn't be a dependency of this Vite SPA).
  const darkMode = useThemeStore((s) => s.darkMode);
  const theme: ToasterProps["theme"] = darkMode ? "dark" : "light";

  return (
    <Sonner
      theme={theme}
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

