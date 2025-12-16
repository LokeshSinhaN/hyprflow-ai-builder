import { Link, useLocation } from "react-router-dom";
import { Bot, Library, MessageSquare, LogOut, BarChart3, Shield, Activity } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import logo from "@/assets/logo.png";
import { ThemeToggle } from "@/components/ThemeToggle";

type LayoutProps = {
  children: React.ReactNode;
  /** Use for the chat page where the workspace needs to span the full viewport width. */
  fullWidth?: boolean;
  mainClassName?: string;
};

export const Layout = ({ children, fullWidth = false, mainClassName }: LayoutProps) => {
  const location = useLocation();
  const { signOut, user, isAdmin } = useAuth();

  const navItems = [
    { to: "/", icon: MessageSquare, label: "Chat" },
    { to: "/library", icon: Library, label: "Library" },
    { to: "/dashboard", icon: BarChart3, label: "Dashboard" },
    ...(isAdmin ? [
      { to: "/admin", icon: Shield, label: "Admin" },
      { to: "/activity-logs", icon: Activity, label: "Activity Logs" }
    ] : []),
  ];

  const mainBaseClassName = fullWidth
    ? "flex-1 w-full px-4 md:px-6 py-6 flex flex-col min-h-0 overflow-hidden"
    : "flex-1 container mx-auto px-6 py-8 flex flex-col min-h-0 overflow-y-auto overscroll-contain";

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ background: 'var(--background-gradient)' }}>
      {/* Header */}
      <header className="border-b border-border/50 backdrop-blur-lg bg-card/30 sticky top-0 z-50">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 group">
            <img src={logo} alt="hyprtask logo" className="w-8 h-8 rounded-lg" />
            <div className="flex flex-col">
              <span className="text-xl font-bold bg-gradient-primary bg-clip-text text-transparent">
                hyprtask
              </span>
              <span className="text-xs text-muted-foreground -mt-1">
                hyprFlow
              </span>
            </div>
          </Link>

          <div className="flex items-center gap-4">
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

            <ThemeToggle />

            {user && (
              <Button variant="ghost" size="sm" onClick={signOut}>
                <LogOut className="w-4 h-4 mr-2" />
                Sign Out
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className={cn(mainBaseClassName, mainClassName)}>
        {children}
      </main>
    </div>
  );
};
