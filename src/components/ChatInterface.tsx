import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Upload, Camera, Send, Sparkles } from "lucide-react";
import { toast } from "sonner";

export const ChatInterface = () => {
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<Array<{ role: "user" | "assistant"; content: string }>>([
    {
      role: "assistant",
      content: "Hello! I'm your AI automation assistant. I can help you create Python scripts for your workflows. Upload a PDF, capture your screen, or just describe what you need!",
    },
  ]);

  const handleSend = () => {
    if (!message.trim()) return;

    setMessages([...messages, { role: "user", content: message }]);
    setMessage("");

    // Simulate AI response
    setTimeout(() => {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "I'll help you create that automation script. Let me analyze your requirements...",
        },
      ]);
    }, 1000);
  };

  const handleUpload = () => {
    toast.info("Upload feature will be available soon with Lovable Cloud");
  };

  const handleScreenCapture = () => {
    toast.info("Screen capture will be available soon with Lovable Cloud");
  };

  return (
    <div className="h-[calc(100vh-12rem)] flex flex-col gap-4">
      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto space-y-4 pr-2">
        {messages.map((msg, idx) => (
          <Card
            key={idx}
            className={cn(
              "p-4 backdrop-blur-sm transition-all",
              msg.role === "user"
                ? "bg-card/80 ml-auto max-w-[80%] border-accent/30"
                : "bg-card/50 mr-auto max-w-[80%]"
            )}
          >
            <div className="flex items-start gap-3">
              {msg.role === "assistant" && (
                <div className="p-1.5 rounded-md bg-gradient-primary shadow-glow">
                  <Sparkles className="w-4 h-4 text-accent-foreground" />
                </div>
              )}
              <p className="text-sm leading-relaxed">{msg.content}</p>
            </div>
          </Card>
        ))}
      </div>

      {/* Action Buttons */}
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={handleUpload}>
          <Upload className="w-4 h-4" />
          Upload PDF
        </Button>
        <Button variant="outline" size="sm" onClick={handleScreenCapture}>
          <Camera className="w-4 h-4" />
          Screen Capture
        </Button>
      </div>

      {/* Input Area */}
      <div className="flex gap-2">
        <Textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Describe the automation workflow you need..."
          className="min-h-[100px] resize-none bg-card/50 backdrop-blur-sm border-border/50 focus:border-accent/50"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
        />
        <Button variant="premium" size="icon" onClick={handleSend} className="h-[100px] w-12">
          <Send className="w-5 h-5" />
        </Button>
      </div>
    </div>
  );
};

function cn(...inputs: any[]) {
  return inputs.filter(Boolean).join(" ");
}
