import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Bot, Sparkles } from "lucide-react";
import { z } from "zod";
import logo from "@/assets/logo.png";

const emailSchema = z.string().email("Invalid email address").max(255);
const passwordSchema = z.string().min(6, "Password must be at least 6 characters");
const nameSchema = z.string().min(2, "Name must be at least 2 characters").max(100);

const Auth = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [errors, setErrors] = useState<{ email?: string; password?: string; fullName?: string }>({});
  const { signIn, signUp } = useAuth();

  const validateForm = () => {
    const newErrors: typeof errors = {};
    
    try {
      emailSchema.parse(email);
    } catch (e) {
      if (e instanceof z.ZodError) {
        newErrors.email = e.errors[0].message;
      }
    }

    try {
      passwordSchema.parse(password);
    } catch (e) {
      if (e instanceof z.ZodError) {
        newErrors.password = e.errors[0].message;
      }
    }

    if (!isLogin) {
      try {
        nameSchema.parse(fullName);
      } catch (e) {
        if (e instanceof z.ZodError) {
          newErrors.fullName = e.errors[0].message;
        }
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateForm()) return;

    if (isLogin) {
      await signIn(email, password);
    } else {
      await signUp(email, password, fullName);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-secondary p-4">
      <Card className="w-full max-w-md p-8 bg-card/50 backdrop-blur-lg border-border/50">
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <img src={logo} alt="hyprtask logo" className="w-16 h-16 rounded-lg" />
          </div>
          <h1 className="text-3xl font-bold mb-1">hyprtask</h1>
          <p className="text-sm text-muted-foreground mb-2">hyprFlow</p>
          <p className="text-muted-foreground text-sm">Create powerful automation workflows with AI</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {!isLogin && (
            <div>
              <Label htmlFor="fullName">Full Name</Label>
              <Input
                id="fullName"
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="mt-1 bg-card/50 border-border/50"
                placeholder="Enter your full name"
              />
              {errors.fullName && (
                <p className="text-destructive text-sm mt-1">{errors.fullName}</p>
              )}
            </div>
          )}

          <div>
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 bg-card/50 border-border/50"
              placeholder="Enter your email"
            />
            {errors.email && (
              <p className="text-destructive text-sm mt-1">{errors.email}</p>
            )}
          </div>

          <div>
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 bg-card/50 border-border/50"
              placeholder="Enter your password"
            />
            {errors.password && (
              <p className="text-destructive text-sm mt-1">{errors.password}</p>
            )}
          </div>

          <Button type="submit" variant="premium" className="w-full">
            <Sparkles className="w-4 h-4 mr-2" />
            {isLogin ? "Sign In" : "Create Account"}
          </Button>
        </form>

        <div className="mt-6 text-center">
          <button
            onClick={() => {
              setIsLogin(!isLogin);
              setErrors({});
            }}
            className="text-sm text-accent hover:underline"
          >
            {isLogin ? "Don't have an account? Sign up" : "Already have an account? Sign in"}
          </button>
        </div>

        <div className="mt-6 p-4 bg-muted/30 rounded-lg border border-border/30">
          <p className="text-xs text-muted-foreground text-center mb-3 font-semibold">
            {isLogin ? "Demo Account" : "Create Demo Account"}
          </p>
          {isLogin ? (
            <>
              <p className="text-xs text-muted-foreground mb-2">
                Don't have an account yet? Switch to sign up and use:
              </p>
              <p className="text-xs text-muted-foreground">Email: demo@hyprflow.com</p>
              <p className="text-xs text-muted-foreground">Password: demo123456</p>
            </>
          ) : (
            <>
              <p className="text-xs text-muted-foreground mb-2">
                Create your account with these credentials:
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full mt-2"
                onClick={() => {
                  setEmail("demo@hyprflow.com");
                  setPassword("demo123456");
                  setFullName("Demo User");
                }}
              >
                Fill Demo Credentials
              </Button>
            </>
          )}
        </div>
      </Card>
    </div>
  );
};

export default Auth;
