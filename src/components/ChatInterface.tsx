import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Upload, Camera, Send, Sparkles, History, FileText, X } from "lucide-react";
import { toast } from "sonner";
import { CodeViewer } from "./CodeViewer";
import { generatePythonScript } from "@/utils/scriptGenerator";
import { ChatHistory } from "./ChatHistory";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export const ChatInterface = () => {
  const [message, setMessage] = useState("");
  const [generatedCode, setGeneratedCode] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Array<{ role: "user" | "assistant"; content: string }>>([
    {
      role: "assistant",
      content: "Hello! I'm your AI automation assistant. I can help you create Python scripts for your workflows. Upload a PDF, capture your screen, or just describe what you need!",
    },
  ]);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingProgress, setProcessingProgress] = useState(0);
  const [uploadedSops, setUploadedSops] = useState<Array<{ id: string; filename: string; status: string; storage_path: string | null }>>([]);
  const [deletingSopId, setDeletingSopId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { user } = useAuth();

  useEffect(() => {
    if (user && !currentConversationId) {
      createNewConversation();
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      loadUploadedSops();
    }
  }, [user]);

  const loadUploadedSops = async () => {
    if (!user) return;

    const { data, error } = await supabase
      .from("sop_documents")
      .select("id, filename, status, storage_path")
      .eq("user_id", user.id)
      .eq("status", "indexed")
      .order("created_at", { ascending: false });

    if (!error && data) {
      setUploadedSops(data);
    }
  };

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
    setMessages([
      {
        role: "assistant",
        content: "Hello! I'm your AI automation assistant. I can help you create Python scripts for your workflows. Upload a PDF, capture your screen, or just describe what you need!",
      },
    ]);
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
    if (role === "user" && messages.length === 1) {
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

    // Generate Python script
    setTimeout(async () => {
      const script = generatePythonScript(userMessage);
      setGeneratedCode(script);

      const assistantMessage = {
        role: "assistant" as const,
        content: "I've generated a Python script for your automation workflow. Check the code panel on the right to view, copy, or download it!",
      };

      setMessages((prev) => [...prev, assistantMessage]);

      // Save assistant message with code
      await saveMessage("assistant", assistantMessage.content, script);
    }, 800);
  };

  const handleDeleteSop = async (sopId: string, storagePath: string) => {
    try {
      // Delete from Qdrant
      const qdrantUrl = import.meta.env.VITE_QDRANT_URL;
      const qdrantApiKey = import.meta.env.VITE_QDRANT_API_KEY;

      // Get chunk IDs from database
      const { data: chunks } = await supabase
        .from('sop_chunks')
        .select('qdrant_point_id')
        .eq('sop_id', sopId);

      if (chunks && chunks.length > 0 && qdrantUrl && qdrantApiKey) {
        const pointIds = chunks.map(c => c.qdrant_point_id);
        
        await fetch(`${qdrantUrl}/collections/sop_chunks/points/delete`, {
          method: 'POST',
          headers: {
            'api-key': qdrantApiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ points: pointIds }),
        });
      }

      // Delete chunks from database
      await supabase
        .from('sop_chunks')
        .delete()
        .eq('sop_id', sopId);

      // Delete from storage
      if (storagePath) {
        await supabase.storage
          .from('sop-documents')
          .remove([storagePath]);
      }

      // Delete document record
      const { error } = await supabase
        .from('sop_documents')
        .delete()
        .eq('id', sopId);

      if (error) throw error;

      toast.success("SOP document deleted successfully");
      loadUploadedSops();
      setDeletingSopId(null);
    } catch (error) {
      console.error('Error deleting SOP:', error);
      toast.error("Failed to delete SOP document");
      setDeletingSopId(null);
    }
  };

  const handleUpload = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.type !== "application/pdf") {
      toast.error("Please upload a PDF file");
      return;
    }

    if (!user) {
      toast.error("Please sign in to upload SOPs");
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);

    try {
      // Simulate upload progress
      const progressInterval = setInterval(() => {
        setUploadProgress((prev) => {
          if (prev >= 90) {
            clearInterval(progressInterval);
            return 90;
          }
          return prev + 10;
        });
      }, 200);

      // Upload to Supabase Storage
      const fileName = `${user.id}/${Date.now()}_${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from("sop-documents")
        .upload(fileName, file);

      clearInterval(progressInterval);

      if (uploadError) throw uploadError;

      setUploadProgress(100);

      // Store metadata in database
      const { data: sopData, error: dbError } = await supabase
        .from("sop_documents")
        .insert({
          user_id: user.id,
          filename: file.name,
          title: file.name.replace(".pdf", ""),
          storage_path: fileName,
          file_size: file.size,
          status: "processing",
        })
        .select()
        .single();

      if (dbError) throw dbError;

      setUploadProgress(100);

      // Trigger processing via edge function
      const { error: processError } = await supabase.functions.invoke("process-sop", {
        body: {
          sopId: sopData.id,
          storagePath: fileName,
        },
      });

      if (processError) {
        console.error("Processing error:", processError);
        toast.error("SOP uploaded but processing failed. Please try again.");
      }

      setTimeout(() => {
        setIsUploading(false);
        setUploadProgress(0);
        toast.success("SOP uploaded and processing started");
      }, 500);
    } catch (error) {
      console.error("Upload error:", error);
      toast.error("Failed to upload SOP");
      setIsUploading(false);
      setUploadProgress(0);
    }

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
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

        {/* Upload Progress Bar */}
        {isUploading && (
          <Card className="p-4 bg-card/80 backdrop-blur-sm border-accent/30">
            <div className="flex items-center gap-3 mb-2">
              <FileText className="w-5 h-5 text-accent animate-pulse" />
              <span className="text-sm font-medium">Uploading SOP...</span>
            </div>
            <Progress value={uploadProgress} className="h-2" />
            <p className="text-xs text-muted-foreground mt-2">{uploadProgress}% complete</p>
          </Card>
        )}

        {/* Processing Progress Bar */}
        {isProcessing && (
          <Card className="p-4 bg-card/80 backdrop-blur-sm border-accent/30">
            <div className="flex items-center gap-3 mb-2">
              <FileText className="w-5 h-5 text-accent animate-spin" />
              <span className="text-sm font-medium">Processing SOP in Qdrant...</span>
            </div>
            <Progress value={processingProgress} className="h-2" />
            <p className="text-xs text-muted-foreground mt-2">{processingProgress}% complete</p>
          </Card>
        )}

        {/* Uploaded SOPs */}
        {uploadedSops.length > 0 && (
          <Card className="p-3 bg-card/60 backdrop-blur-sm border-border/50">
            <div className="flex items-center gap-2 mb-2">
              <FileText className="w-4 h-4 text-accent" />
              <span className="text-xs font-medium text-muted-foreground">Uploaded SOPs:</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {uploadedSops.map((sop) => (
                <div
                  key={sop.id}
                  className="group flex items-center gap-2 px-3 py-1.5 rounded-md bg-accent/10 border border-accent/20 hover:bg-accent/20 transition-colors"
                >
                  <FileText className="w-3.5 h-3.5 text-accent flex-shrink-0" />
                  <span className="text-xs font-medium truncate max-w-[200px]">{sop.filename}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 w-5 p-0 ml-1 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => setDeletingSopId(sop.id)}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          </Card>
        )}

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
            disabled={isUploading}
          >
            <Upload className="w-4 h-4" />
            Upload SOP
          </Button>
          <Button variant="outline" size="sm" onClick={handleScreenCapture}>
            <Camera className="w-4 h-4" />
            Screen Capture
          </Button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf"
          onChange={handleFileSelect}
          className="hidden"
        />

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

      <AlertDialog open={!!deletingSopId} onOpenChange={() => setDeletingSopId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete SOP Document</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this SOP? This will remove the document from storage, the database, and the vector database. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const sop = uploadedSops.find(s => s.id === deletingSopId);
                if (sop) {
                  handleDeleteSop(sop.id, sop.storage_path);
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
