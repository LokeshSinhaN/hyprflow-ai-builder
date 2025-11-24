import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Upload, Camera, Send, Sparkles, History } from "lucide-react";
import { toast } from "sonner";
import { CodeViewer } from "./CodeViewer";
import { supabase } from "@/integrations/supabase/client";
import { ChatHistory } from "./ChatHistory";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

const MAX_MESSAGE_LENGTH = 10000;

interface SOPDocument {
  id: string;
  title: string;
  filename: string;
  status: "uploaded" | "processing" | "indexed" | "failed";
  created_at: string;
  content?: string; // Local-only SOP content for context (not persisted)
}

export const ChatInterface = () => {
  const [message, setMessage] = useState("");
  const [generatedScripts, setGeneratedScripts] =
    useState<{ python: string; playwright?: string | null } | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>("local-conversation");
  const [messages, setMessages] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const [uploadedDocument, setUploadedDocument] = useState<string | null>(null);
  const [sopDocuments, setSopDocuments] = useState<SOPDocument[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // In auth-free dev mode, conversations and SOPs are kept entirely in local state.
  useEffect(() => {
    // Initialize a blank local conversation on first render
    if (!currentConversationId) {
      setCurrentConversationId("local-conversation");
    }
  }, [currentConversationId]);

  const handleDeleteSOP = (sopId: string) => {
    // Local-only delete; we don't touch the database in dev mode.
    setSopDocuments((prev) => {
      const updated = prev.filter((doc) => doc.id !== sopId);
      if (updated.length === 0) {
        setUploadedDocument(null);
      }
      return updated;
    });
    toast.success("SOP removed from current session");
  };

  const createNewConversation = async () => {
    // Local-only conversations: just reset state.
    setCurrentConversationId("local-conversation-" + Date.now().toString());
    setMessages([]);
    setGeneratedScripts(null);
  };

  const loadConversation = async (_conversationId: string) => {
    // In dev mode we don't persist multiple conversations; this is a no-op.
    return;
  };

  const saveMessage = async (_role: "user" | "assistant", _content: string, _code?: string) => {
    // No-op in auth-free dev mode; messages are already in local React state.
    return;
  };

  const handleSend = async () => {
    if (!message.trim()) return;

    // Require at least one indexed SOP with content before generating scripts
    if (!sopDocuments.some((d) => d.status === "indexed" && d.content)) {
      toast.error("Please upload at least one SOP PDF before generating a script.");
      return;
    }

    if (message.length > MAX_MESSAGE_LENGTH) {
      toast.error(`Message too long. Maximum ${MAX_MESSAGE_LENGTH.toLocaleString()} characters allowed.`);
      return;
    }

    const userMessage = message;
    const newMessages = [...messages, { role: "user" as const, content: userMessage }];
    setMessages(newMessages);
    setMessage("");

    // Messages are already stored in local state; no persistence needed.
    await saveMessage("user", userMessage);

    setIsProcessing(true);

    try {
      // Build optional SOP context from locally uploaded documents.
      const sopContext = sopDocuments
        .filter((doc) => doc.status === "indexed" && doc.content)
        .map((doc, idx) => `\n\n=== SOP ${idx + 1}: ${doc.title} ===\n${doc.content}`)
        .join("\n");

      // Use generate-script-rag edge function so SOP context is handled via RAG-style prompt.
      const { data, error } = await supabase.functions.invoke("generate-script-rag", {
        body: {
          message: userMessage,
          sop_text: sopContext || undefined,
        },
      });

      if (error) throw error;
      if (data.error) {
        throw new Error(data.error);
      }

      // RAG function may return { scripts: { python_selenium, python_playwright, ... } }
      const pythonScript =
        (data.scripts?.python_selenium || data.scripts?.python || data.script) as string;
      const playwrightScript = (data.scripts?.python_playwright ?? null) as string | null;

      setGeneratedScripts({ python: pythonScript, playwright: playwrightScript });

      const contextInfo = sopContext
        ? " I used your uploaded SOP documents as additional context."
        : "";

      const assistantMessage = {
        role: "assistant" as const,
        content: "I've generated a Python script for your automation workflow. Check the code panel on the right to view, copy, or download it!",
      };

      setMessages((prev) => [...prev, assistantMessage]);

      // Save assistant message with primary Python code (no-op in dev mode)
      await saveMessage("assistant", assistantMessage.content, pythonScript);
      
      // Clear uploaded document after successful generation
      if (uploadedDocument) {
        setUploadedDocument(null);
      }
    } catch (error) {
      console.error("Error generating script:", error);
      toast.error(error instanceof Error ? error.message : "Failed to generate script. Please try again.");
    }
  };

  const handleUpload = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
  const file = event.target.files?.[0];
  if (!file) return;

  if (file.type !== "application/pdf") {
    toast.error("Please upload a PDF file");
    event.target.value = "";
    return;
  }

  setIsProcessing(true);
  const loadingToast = toast.loading(`Uploading "${file.name}"...`);

  try {
    // Create FormData and upload via fetch. No auth or user_id required in dev mode.
    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch(
      `${supabase.supabaseUrl}/functions/v1/process-sop`,
      {
        method: "POST",
        body: formData,
      }
    );

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || "Upload failed");
    }

    const data = await response.json();

    if (data.error) throw new Error(data.error);

    toast.dismiss(loadingToast);
    toast.success(
      `SOP "${data.title || file.name}" uploaded successfully and processed for this session.`,
    );

    // Store SOP locally so it can be used as context in generate-script.
    const newDoc: SOPDocument = {
      id: data.sopId || `${Date.now()}`,
      title: data.title || file.name,
      filename: file.name,
      status: "indexed",
      created_at: new Date().toISOString(),
      content: data.fullContent || data.content || "",
    };

    setSopDocuments((prev) => [newDoc, ...prev]);
    setUploadedDocument(newDoc.title);

    // Set suggested message
    setMessage(
      `Generate a Python automation script based on the uploaded SOP: ${data.title || file.name}`,
    );

  } catch (error) {
    console.error("Error uploading SOP:", error);
    toast.dismiss(loadingToast);
    toast.error(error instanceof Error ? error.message : "Failed to upload SOP. Please try again.");
  } finally {
    setIsProcessing(false);
    event.target.value = "";
  }
};


  const handleScreenCapture = () => {
    toast.info("Coming Soon");
  };

  return (
    <div className="h-[calc(100vh-12rem)] flex gap-4 overflow-hidden">
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
      <div className="flex-1 min-h-0 flex flex-col gap-4">
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
          <Button 
            variant="outline" 
            size="sm" 
            onClick={handleUpload}
            disabled={isProcessing}
          >
            <Upload className="w-4 h-4" />
            {uploadedDocument ? "SOP Uploaded ✓" : "Upload SOP"}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            onChange={handleFileChange}
            className="hidden"
          />
          <Button variant="outline" size="sm" onClick={handleScreenCapture}>
            <Camera className="w-4 h-4" />
            Screen Capture
          </Button>
        </div>

        {/* Uploaded SOPs List */}
        {sopDocuments.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>Uploaded SOPs (this session):</span>
            {sopDocuments.map((doc) => (
              <Badge
                key={doc.id}
                variant="secondary"
                className="flex items-center gap-2 max-w-xs"
              >
                <span className="truncate">{doc.title}</span>
                <button
                  type="button"
                  onClick={() => handleDeleteSOP(doc.id)}
                  className="text-[10px] uppercase tracking-wide hover:text-destructive"
                >
                  Remove
                </button>
              </Badge>
            ))}
          </div>
        )}

        {/* Input Area */}
        <div className="flex gap-2 mt-2">
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={uploadedDocument ? "Ask me to generate automation scripts based on your uploaded SOP..." : "Describe the automation workflow you need..."}
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
      <div className="flex-1 min-h-0 flex flex-col">
        {generatedScripts ? (
          <CodeViewer
            pythonCode={generatedScripts.python}
            playwrightCode={generatedScripts.playwright ?? undefined}
          />
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
