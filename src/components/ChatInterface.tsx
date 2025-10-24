import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Upload, Camera, Send, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { CodeViewer } from "./CodeViewer";
import { generatePythonScript } from "@/utils/scriptGenerator";
import { cn } from "@/lib/utils";

export const ChatInterface = () => {
  const [message, setMessage] = useState("");
  const [generatedCode, setGeneratedCode] = useState("");
  const [messages, setMessages] = useState<Array<{ role: "user" | "assistant"; content: string }>>([
    {
      role: "assistant",
      content: "Hello! I'm your AI automation assistant. I can help you create Python scripts for your workflows. Upload a PDF, capture your screen, or just describe what you need!",
    },
  ]);

  const handleSend = () => {
    if (!message.trim()) return;

    const userMessage = message;
    setMessages([...messages, { role: "user", content: userMessage }]);
    setMessage("");

    // Generate Python script
    setTimeout(() => {
      const script = generatePythonScript(userMessage);
      setGeneratedCode(script);
      
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "I've generated a Python script for your automation workflow. Check the code panel on the right to view, copy, or download it!",
        },
      ]);
    }, 800);
  };

  const handleUpload = () => {
    toast.info("Upload feature will be available soon with Lovable Cloud");
  };

  const handleScreenCapture = () => {
    toast.info("Screen capture will be available soon with Lovable Cloud");
  };

  return (
    <div className="h-[calc(100vh-12rem)] flex gap-4">
      {/* Left Panel - Chat */}
      <div className="flex-1 flex flex-col gap-4">
        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto space-y-4 pr-2">
          {messages.map((msg, idx) => (
            <Card
              key={idx}
              className={cn(
                "p-4 backdrop-blur-sm transition-all",
                msg.role === "user"
                  ? "bg-card/80 ml-auto max-w-[85%] border-accent/30"
                  : "bg-card/50 mr-auto max-w-[85%]"
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

      {/* Right Panel - Code Viewer */}
      <div className="flex-1">
        {generatedCode ? (
          <CodeViewer code={generatedCode} language="python" />
        ) : (
          <Card className="h-full flex items-center justify-center bg-card/30 backdrop-blur-sm border-border/50 border-dashed">
            <div className="text-center text-muted-foreground p-8">
              <Sparkles className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p className="text-lg font-medium">Generated code will appear here</p>
              <p className="text-sm mt-2">Start by describing your automation workflow</p>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
};
