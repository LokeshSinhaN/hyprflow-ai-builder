import { Link, useLocation } from "react-router-dom";
import { Bot, Library, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";

export const Layout = ({ children }: { children: React.ReactNode }) => {
  const location = useLocation();

  const navItems = [
    { to: "/", icon: MessageSquare, label: "Chat" },
    { to: "/library", icon: Library, label: "Library" },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-gradient-secondary">
      {/* Header */}
      <header className="border-b border-border/50 backdrop-blur-lg bg-card/30 sticky top-0 z-50">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 group">
            <div className="p-2 rounded-lg bg-gradient-primary shadow-glow">
              <Bot className="w-5 h-5 text-accent-foreground" />
            </div>
            <span className="text-xl font-bold bg-gradient-primary bg-clip-text text-transparent">
              hyprFlow
            </span>
          </Link>

          <nav className="flex gap-2">
            {navItems.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-lg transition-all",
                  location.pathname === item.to
                    ? "bg-accent/10 text-accent shadow-glow"
                    : "hover:bg-card/50 text-muted-foreground hover:text-foreground"
                )}
              >
                <item.icon className="w-4 h-4" />
                <span className="font-medium">{item.label}</span>
              </Link>
            ))}
          </nav>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 container mx-auto px-4 py-6">
        {children}
      </main>

      {/* Footer */}
      <footer className="border-t border-border/50 backdrop-blur-lg bg-card/30 py-4">
        <div className="container mx-auto px-4 text-center">
          <p className="text-sm text-muted-foreground">
            powered by <span className="text-accent">hyprtask</span>
          </p>
        </div>
      </footer>
    </div>
  );
};
