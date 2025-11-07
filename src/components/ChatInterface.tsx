import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Upload, Camera, Send, Sparkles, History } from "lucide-react";
import { toast } from "sonner";
import { CodeViewer } from "./CodeViewer";
import { supabase } from "@/integrations/supabase/client";
import { ChatHistory } from "./ChatHistory";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";

export const ChatInterface = () => {
  const [message, setMessage] = useState("");
  const [generatedCode, setGeneratedCode] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const { user } = useAuth();

  useEffect(() => {
    if (user && !currentConversationId) {
      createNewConversation();
    }
  }, [user]);

  const createNewConversation = async () => {
    if (!user) return;

    const { data, error } = await supabase
      .from("conversations")
      .insert({
        user_id: user.id,
        title: "New Workflow",
      })
      .select()
      .single();

    if (error) {
      console.error("Error creating conversation:", error);
      toast.error("Failed to create conversation");
      return;
    }

    setCurrentConversationId(data.id);
    setMessages([]);
    setGeneratedCode("");
  };

  const loadConversation = async (conversationId: string) => {
    const { data, error } = await supabase
      .from("chat_messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Error loading messages:", error);
      toast.error("Failed to load conversation");
      return;
    }

    setCurrentConversationId(conversationId);
    const loadedMessages = data.map((msg) => ({
      role: msg.role as "user" | "assistant",
      content: msg.content,
    }));

    // If there's code in the last message, show it
    const lastMessageWithCode = data.reverse().find((msg) => msg.code);
    if (lastMessageWithCode) {
      setGeneratedCode(lastMessageWithCode.code);
    }

    setMessages(loadedMessages);
  };

  const saveMessage = async (role: "user" | "assistant", content: string, code?: string) => {
    if (!currentConversationId) return;

    const { error } = await supabase.from("chat_messages").insert({
      conversation_id: currentConversationId,
      role,
      content,
      code: code || null,
    });

    if (error) {
      console.error("Error saving message:", error);
    }

    // Update conversation title if it's the first user message
    if (role === "user" && messages.length === 0) {
      const title = content.substring(0, 50) + (content.length > 50 ? "..." : "");
      await supabase
        .from("conversations")
        .update({ title })
        .eq("id", currentConversationId);
    }
  };

  const handleSend = async () => {
    if (!message.trim() || !currentConversationId) return;

    const userMessage = message;
    const newMessages = [...messages, { role: "user" as const, content: userMessage }];
    setMessages(newMessages);
    setMessage("");

    // Save user message
    await saveMessage("user", userMessage);

    try {
      // Call edge function to generate Python script with AI
      const { data, error } = await supabase.functions.invoke('generate-script', {
        body: { message: userMessage }
      });

      if (error) throw error;

      if (data.error) {
        throw new Error(data.error);
      }

      const script = data.script;
      setGeneratedCode(script);

      // Log script generation activity
      if (user) {
        await supabase.rpc('log_user_activity', {
          _user_id: user.id,
          _activity_type: 'script_generated',
          _activity_description: 'User generated a Python script',
          _metadata: { conversation_id: currentConversationId, prompt_length: userMessage.length }
        });
      }

      const assistantMessage = {
        role: "assistant" as const,
        content: "I've generated a Python script for your automation workflow. Check the code panel on the right to view, copy, or download it!",
      };

      setMessages((prev) => [...prev, assistantMessage]);

      // Save assistant message with code
      await saveMessage("assistant", assistantMessage.content, script);
    } catch (error) {
      console.error("Error generating script:", error);
      toast.error(error instanceof Error ? error.message : "Failed to generate script. Please try again.");
    }
  };

  const handleUpload = () => {
    toast.info("Upload feature will be available soon with Lovable Cloud");
  };

  const handleScreenCapture = () => {
    toast.info("Screen capture will be available soon with Lovable Cloud");
  };

  return (
    <div className="h-[calc(100vh-12rem)] flex gap-4">
      {/* Chat History Sidebar */}
      {showHistory && (
        <div className="w-64 flex-shrink-0">
          <ChatHistory
            currentConversationId={currentConversationId}
            onSelectConversation={loadConversation}
            onNewConversation={createNewConversation}
          />
        </div>
      )}

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
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowHistory(!showHistory)}
          >
            <History className="w-4 h-4" />
            {showHistory ? "Hide" : "Show"} History
          </Button>
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
