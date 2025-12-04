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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const MAX_MESSAGE_LENGTH = 10000;

interface SOPDocument {
  id: string;
  title: string;
  filename: string;
  status: "uploaded" | "processing" | "indexed" | "failed";
  created_at: string;
  content?: string; // Local-only SOP content for context (not persisted)
}

type ScriptConfigEntry = {
  key: string;
  value: string;
  originalValue: string;
  inputType: "text" | "password";
};

const CONFIG_NAME_KEYWORDS = [
  "username",
  "user_name",
  "password",
  "email",
  "mail",
  "url",
  "uri",
  "link",
  "endpoint",
  "path",
  "driver",
  "directory",
  "hashtag",
  "tag",
  "login",
  "domain",
  "account",
  "profile",
  "keyword",
  "search",
  "timeout",
  "delay",
  "wait",
  "seconds",
  "limit",
  "max_",
  "min_",
];

const isLikelyConfigVariable = (name: string, value: string): boolean => {
  const lowerName = name.toLowerCase();
  if (CONFIG_NAME_KEYWORDS.some((keyword) => lowerName.includes(keyword))) {
    return true;
  }

  const lowerValue = value.toLowerCase();
  if (!lowerValue) return false;

  // Typical placeholder patterns that the LLM uses for unknown values
  return (
    lowerValue.includes("your_") ||
    lowerValue.includes("your ") ||
    lowerValue.includes("example.com") ||
    lowerValue.includes("changeme") ||
    lowerValue.includes("<#") ||
    lowerValue.startsWith("#")
  );
};

const detectConfigEntriesFromCode = (code: string): ScriptConfigEntry[] => {
  // Restrict scanning to the header / configuration section at the top of the file
  const lines = code.split("\n");
  const headerLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (
      trimmed.startsWith("def ") ||
      trimmed.startsWith("class ") ||
      trimmed.startsWith("SELECTORS ") ||
      trimmed.startsWith("# --- Selectors")
    ) {
      break;
    }
    headerLines.push(line);
  }

  const header = headerLines.join("\n");
  const regex = /^([A-Z_][A-Z0-9_]*)\s*=\s*r?['"]([^'"\n]*)['"]/gm;
  const entries: ScriptConfigEntry[] = [];
  const seen = new Set<string>();

  let match: RegExpExecArray | null;
  while ((match = regex.exec(header)) !== null) {
    const name = match[1];
    const value = match[2] ?? "";

    if (!name || seen.has(name)) continue;
    if (!isLikelyConfigVariable(name, value)) continue;

    seen.add(name);

    const lowerName = name.toLowerCase();
    const lowerValue = value.toLowerCase();
    const isPasswordLike =
      lowerName.includes("password") ||
      lowerName.includes("secret") ||
      lowerName.includes("token") ||
      lowerName.endsWith("_key") ||
      lowerValue.includes("password");

    entries.push({
      key: name,
      value,
      originalValue: value,
      inputType: isPasswordLike ? "password" : "text",
    });
  }

  return entries;
};

const applyConfigEntriesToCode = (code: string, entries: ScriptConfigEntry[]): string => {
  let updated = code;

  for (const entry of entries) {
    const { key, value } = entry;
    if (!value) continue;

    const lowerName = key.toLowerCase();
    const shouldUseRawString =
      lowerName.includes("path") || lowerName.includes("dir") || lowerName.includes("driver");

    const escaped = shouldUseRawString
      ? value.replace(/\\/g, "\\\\")
      : value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

    const pattern = new RegExp(`${key}\\s*=\\s*r?['"][^'"\n]*['"]`);
    const replacement = shouldUseRawString
      ? `${key} = r"${escaped}"`
      : `${key} = "${escaped}"`;

    updated = updated.replace(pattern, replacement);
  }

  return updated;
};

export const ChatInterface = () => {
  const [message, setMessage] = useState("");
  const [generatedScripts, setGeneratedScripts] =
    useState<{ python: string; playwright?: string | null } | null>(null);
  const [baseScripts, setBaseScripts] =
    useState<{ python: string; playwright?: string | null } | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>("local-conversation");
  const [messages, setMessages] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const [uploadedDocument, setUploadedDocument] = useState<string | null>(null);
  const [sopDocuments, setSopDocuments] = useState<SOPDocument[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showConfigForm, setShowConfigForm] = useState(false);
  const [configEntries, setConfigEntries] = useState<ScriptConfigEntry[]>([]);
  const [targetUrl, setTargetUrl] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

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

  const waitForPreflightJob = async (jobId: string) => {
    const maxAttempts = 15;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const { data, error } = await supabase.functions.invoke("preflight-job", {
        body: { job_id: jobId },
      });

      if (error) throw error;
      if (!data?.job) throw new Error("Invalid response from preflight-job function");

      const job = data.job as { status: string; has_dom_html?: boolean; error?: string };

      if (job.status === "done") {
        if (!job.has_dom_html) {
          throw new Error("Pre-flight job completed but DOM HTML is missing.");
        }
        return job;
      }

      if (job.status === "error") {
        throw new Error(job.error || "Pre-flight job failed.");
      }

      // pending or running: backoff a bit before next poll
      const delay = Math.min(1000 * (attempt + 1), 5000);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    throw new Error("Pre-flight job timed out. Please try again.");
  };

  const createNewConversation = async () => {
    // Local-only conversations: just reset state.
    setCurrentConversationId("local-conversation-" + Date.now().toString());
    setMessages([]);
    setGeneratedScripts(null);
    setBaseScripts(null);
    setShowConfigForm(false);
    setConfigEntries([]);
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

      let functionResponse: any;

      if (targetUrl.trim()) {
        // Pre-flight pipeline: create job -> wait for DOM -> generate script with DOM
        const cleanedUrl = targetUrl.trim();

        const { data: startData, error: startError } = await supabase.functions.invoke("preflight-job", {
          body: { target_url: cleanedUrl },
        });

        if (startError) throw startError;
        if (!startData?.job?.id) {
          throw new Error("Failed to create pre-flight job.");
        }

        const jobId = startData.job.id as string;

        // Wait for GitHub Action + Selenium to finish DOM extraction
        await waitForPreflightJob(jobId);

        const { data: scriptData, error: scriptError } = await supabase.functions.invoke(
          "generate-script-preflight",
          {
            body: {
              message: userMessage,
              sop_text: sopContext || undefined,
              job_id: jobId,
            },
          },
        );

        if (scriptError) throw scriptError;
        functionResponse = scriptData;
      } else {
        // Legacy RAG-only pipeline (no pre-flight DOM)
        const { data, error } = await supabase.functions.invoke("generate-script-rag", {
          body: {
            message: userMessage,
            sop_text: sopContext || undefined,
          },
        });

        if (error) throw error;
        functionResponse = data;
      }

      if (functionResponse.error) {
        throw new Error(functionResponse.error as string);
      }

      // Functions return { scripts: { python_selenium, python_playwright, ... } } or { script }
      const pythonScript =
        (functionResponse.scripts?.python_selenium ||
          functionResponse.scripts?.python ||
          functionResponse.script) as string;
      const playwrightScript = (functionResponse.scripts?.python_playwright ?? null) as string | null;

      const scripts = { python: pythonScript, playwright: playwrightScript };
      setBaseScripts(scripts);
      setGeneratedScripts(scripts);
      setShowConfigForm(false);
      setConfigEntries([]);

      const assistantMessage = {
        role: "assistant" as const,
        content:
          "I've generated a Python script for your automation workflow. Check the code panel on the right to view, copy, or download it!",
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
    } finally {
      // Allow user to upload a new SOP or run again after generation completes or fails
      setIsProcessing(false);
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

  const handleOpenConfig = () => {
    const base = baseScripts ?? generatedScripts;

    if (!base || !base.python) {
      toast.error("Generate a script first, then click Run to configure it.");
      return;
    }

    const detected = detectConfigEntriesFromCode(base.python);

    if (detected.length === 0) {
      toast.info("No configurable values were detected at the top of the script.");
      return;
    }

    setConfigEntries(detected);
    setShowConfigForm(true);

    // Smoothly scroll the chat column so the config card is visible to the user
    setTimeout(() => {
      const container = messagesContainerRef.current;
      if (container) {
        container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
      }
    }, 50);
  };

  const handleApplyConfig = () => {
    const base = baseScripts ?? generatedScripts;

    if (!base || !base.python) {
      toast.error("No script available to configure.");
      return;
    }

    const updatedPython = applyConfigEntriesToCode(base.python, configEntries);
    const updatedPlaywright = base.playwright
      ? applyConfigEntriesToCode(base.playwright, configEntries)
      : base.playwright;

    setGeneratedScripts({ python: updatedPython, playwright: updatedPlaywright ?? null });
    setShowConfigForm(false);
    toast.success("Configuration applied. You can now copy or download the updated script.");

    // Add a short assistant message in the chat history to confirm the update
    setMessages((prev) => [
      ...prev,
      {
        role: "assistant" as const,
        content:
          "Your configuration values have been applied to the generated script. You can now copy or download the updated code.",
      },
    ]);
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

      {/* Left Panel - Chat (40% width) */}
      <div className="basis-2/5 min-w-0 min-h-0 flex flex-col gap-4">
        {/* Messages Area (includes config card so bottom chat controls stay fixed) */}
        <div ref={messagesContainerRef} className="flex-1 overflow-y-auto space-y-4 pr-2">
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

          {showConfigForm && configEntries.length > 0 && (
            <Card className="p-6 space-y-6 bg-card/60 border-border/60 shadow-sm">
              <div>
                <p className="text-sm font-semibold uppercase tracking-wide text-foreground">
                  Required Configs
                </p>
              </div>

              <div className="max-h-64 overflow-y-auto space-y-3 pr-1">
                {configEntries.map((entry, index) => (
                  <div key={entry.key} className="space-y-1">
                    <Label htmlFor={`config-${entry.key}`} className="text-xs font-semibold tracking-wide">
                      {entry.key}
                    </Label>
                    <Input
                      id={`config-${entry.key}`}
                      type={entry.inputType}
                      value={entry.value}
                      placeholder={entry.originalValue || entry.key}
                      onChange={(e) => {
                        const next = [...configEntries];
                        next[index] = { ...next[index], value: e.target.value };
                        setConfigEntries(next);
                      }}
                      className="text-xs h-9"
                    />
                  </div>
                ))}
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" size="sm" onClick={() => setShowConfigForm(false)}>
                  Cancel
                </Button>
                <Button variant="premium" size="sm" onClick={handleApplyConfig}>
                  Submit
                </Button>
              </div>
            </Card>
          )}
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

        {/* Target URL for Pre-Flight (optional) */}
        <div className="flex items-center gap-2 mt-2 text-xs">
          <Label htmlFor="target-url" className="font-medium">
            Target URL (optional, enables Pre-Flight DOM scan)
          </Label>
          <Input
            id="target-url"
            type="url"
            value={targetUrl}
            onChange={(e) => setTargetUrl(e.target.value)}
            placeholder="https://example.com/login"
            className="flex-1 h-8 text-xs"
          />
        </div>

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

      {/* Right Panel - Code Viewer (60% width) */}
      <div className="basis-3/5 min-w-0 min-h-0 flex flex-col relative">
        {isProcessing && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-background/80 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-3">
              <div className="p-3 rounded-full bg-gradient-to-tr from-accent to-primary shadow-glow">
                <Sparkles className="w-6 h-6 text-primary-foreground animate-pulse" />
              </div>
              <p className="text-xs text-muted-foreground">
                Generating scripts with your SOP...
              </p>
            </div>
          </div>
        )}
        {generatedScripts ? (
          <CodeViewer
            pythonCode={generatedScripts.python}
            playwrightCode={generatedScripts.playwright ?? undefined}
            onRun={handleOpenConfig}
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
