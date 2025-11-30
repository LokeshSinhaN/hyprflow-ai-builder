import { useState, useEffect, useRef, type FormEvent } from "react";
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

type RunStep = "idle" | "collecting" | "running";

interface RunOutput {
  stdout: string;
  stderr: string;
  error?: string;
}

interface RunConfigField {
  name: string;
  defaultValue?: string;
}

type RunConfigValues = Record<string, string>;

const extractRunConfigFields = (code: string): RunConfigField[] => {
  const lines = code.split(/\r?\n/);
  const fields: RunConfigField[] = [];

  let inConfig = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();

    // Enter config section on a line like "# --- Configuration ---" or "# Configuration"
    if (!inConfig && (/#\s*-+\s*configuration/i.test(trimmed) || /#\s*configuration/i.test(trimmed))) {
      inConfig = true;
      continue;
    }

    if (!inConfig) continue;

    // Stop when we hit function definitions or main guard
    if (/^def\s+\w+\s*\(/.test(trimmed) || /^if __name__\s*==/.test(trimmed)) {
      break;
    }

    const match = /^([A-Z_][A-Z0-9_]*)\s*=\s*(.+)$/.exec(trimmed);
    if (!match) continue;

    const [, name, rawValue] = match;
    const lowerName = name.toLowerCase();

    // Ignore obvious selector / locator style constants which the LLM can derive
    if (/selector|xpath|css|locator/.test(lowerName)) continue;

    // Only consider string values
    let defaultValue: string | undefined;
    const strMatch = rawValue.trim().match(/^(['"])(.*)\1/);
    if (strMatch) {
      defaultValue = strMatch[2];
    } else {
      continue;
    }

    const dv = defaultValue ?? "";

    // Heuristics: which constants should be user-specified?
    const isCredential = /password|passwd|token|secret|key/.test(lowerName);
    const isIdentity = /username|user_name|user\b|email|account/.test(lowerName);
    const isUrl = /url/.test(lowerName);
    const isPathLike = /path|folder|directory|download/.test(lowerName);
    const isSearchLike = /hashtag|search|query|keyword|term/.test(lowerName);

    // Obvious placeholders: your_*, example.com, TODO, angle-brace templates, etc.
    const looksPlaceholder = /your_|example\.com|<|TODO/i.test(dv);

    // Decide if this constant should be asked from the user.
    // - Always ask for credentials, identity, and search-like values.
    // - For URLs/paths, only ask when the value looks like a placeholder or is empty.
    const shouldAskUser =
      isCredential ||
      isIdentity ||
      isSearchLike ||
      looksPlaceholder ||
      ((isUrl || isPathLike) && (looksPlaceholder || dv.trim().length === 0));

    if (!shouldAskUser) continue;

    fields.push({ name, defaultValue });
  }

  return fields;
};

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

  // Cloud run state (Selenium only, driven by generated code)
  const [runStep, setRunStep] = useState<RunStep>("idle");
  const [runConfigFields, setRunConfigFields] = useState<RunConfigField[]>([]);
  const [runConfig, setRunConfig] = useState<RunConfigValues>({});
  const [pendingRunCode, setPendingRunCode] = useState<string | null>(null);
  const [runOutput, setRunOutput] = useState<RunOutput | null>(null);
  const [isRunExecuting, setIsRunExecuting] = useState(false);
  const [latestScreenshotUrl, setLatestScreenshotUrl] = useState<string | null>(null);

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

  const buildConfiguredRunCode = () => {
    if (!pendingRunCode) return null;
    let configured = pendingRunCode;

    runConfigFields.forEach((field) => {
      const raw = (runConfig[field.name] ?? field.defaultValue ?? "").trim();
      if (!raw) return;

      const safeValue = raw.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      const pattern = new RegExp(`^\\s*${field.name}\\s*=.*$`, "m");
      const replacement = `${field.name} = "${safeValue}"`;

      if (pattern.test(configured)) {
        configured = configured.replace(pattern, replacement);
      } else {
        // If the constant wasn't found (edge case), prepend it.
        configured = `${replacement}\n${configured}`;
      }
    });

    return configured;
  };

  const executeSeleniumRun = async () => {
    const configuredCode = buildConfiguredRunCode();
    if (!configuredCode) {
      toast.error("No Selenium script available to run.");
      setRunStep("idle");
      return;
    }

    setIsRunExecuting(true);
    setRunOutput(null);
    setLatestScreenshotUrl(null);

    try {
      // Call new start-selenium-job edge function which enqueues work for GitHub Actions
      const { data, error } = await supabase.functions.invoke("start-selenium-job", {
        body: { script: configuredCode },
      });

      if (error) throw error;
      const jobId = data?.jobId as string | undefined;
      if (!jobId) {
        throw new Error("start-selenium-job did not return a jobId");
      }

      toast.info(`Selenium job queued in cloud (jobId: ${jobId})`);

      // Simple polling loop for job status so we don't depend on Realtime setup
      // On a cold Render free instance, startup alone can take ~60s, and the
      // Selenium job itself may take another 60–120s. Give the job up to
      // ~5 minutes (150 attempts * 2s) before declaring a timeout.
      const pollJob = async (attempt = 0): Promise<void> => {
        if (attempt > 150) {
          setRunOutput({
            stdout: "",
            stderr: "",
            error: "Timed out waiting for cloud job to finish.",
          });
          toast.error("Timed out waiting for cloud job to finish.");
          return;
        }

        const { data: job, error: jobError } = await supabase
          .from("automation_jobs")
          // Select all columns so we can safely read optional log fields without
          // causing errors if the schema changes (e.g. stdout/log_output columns).
          .select("*")
          .eq("id", jobId)
          .single();

        if (jobError) {
          console.error("Error polling automation_jobs:", jobError);
          setRunOutput({ stdout: "", stderr: "", error: jobError.message ?? "Failed to poll job status" });
          toast.error("Failed to poll job status");
          return;
        }

        const latestUrl = (job?.latest_screenshot_url as string | null) ?? null;
        if (latestUrl) {
          setLatestScreenshotUrl(latestUrl);
        }

        const status = job.status as string;
        if (status === "queued" || status === "running") {
          setRunOutput({
            stdout: `Status: ${status}`,
            stderr: "",
          });
          // Wait 2 seconds and poll again
          await new Promise((resolve) => setTimeout(resolve, 2000));
          return pollJob(attempt + 1);
        }

        // Try to surface any textual logs the worker may have stored on the job.
        const logText =
          (job?.log_output as string | null) ??
          (job?.logs as string | null) ??
          (job?.stdout as string | null) ??
          (job?.output_text as string | null) ??
          "";

        if (status === "completed") {
          setRunOutput({
            stdout: logText || "Cloud job completed successfully.",
            stderr: "",
          });
          toast.success("Cloud Selenium job completed successfully!");
        } else {
          setRunOutput({
            stdout: logText,
            stderr: "",
            error: job.error_message || `Cloud job failed with status: ${status}`,
          });
          toast.error("Cloud Selenium job failed");
        }
      };

      await pollJob();
    } catch (error) {
      console.error("Error running Selenium script via cloud job:", error);
      setRunOutput({
        stdout: "",
        stderr: "",
        error: error instanceof Error ? error.message : "Failed to enqueue or monitor cloud job",
      });
      toast.error("Failed to start cloud Selenium job");
    } finally {
      setIsRunExecuting(false);
      setRunStep("idle");
    }
  };

  const handleSubmitRunConfig = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const missing = runConfigFields
      .filter((field) => !(runConfig[field.name] ?? field.defaultValue)?.toString().trim())
      .map((field) => field.name);

    if (missing.length > 0) {
      toast.error(`Please provide values for: ${missing.join(", ")}`);
      return;
    }

    setRunStep("running");
    setMessages((prev) => [
      ...prev,
      {
        role: "assistant" as const,
        content: "Thanks! Starting the Selenium run in the cloud/backend now...",
      },
    ]);

    await executeSeleniumRun();
  };

  const handleCancelRunConfig = () => {
    setRunStep("idle");
    setPendingRunCode(null);
  };

  const handleSend = async () => {
    if (!message.trim()) return;

    const userMessage = message;
    const newMessages = [...messages, { role: "user" as const, content: userMessage }];
    setMessages(newMessages);
    setMessage("");

    // Require at least one indexed SOP with content before generating scripts
    if (!sopDocuments.some((d) => d.status === "indexed" && d.content)) {
      toast.error("Please upload at least one SOP PDF before generating a script.");
      return;
    }

    if (userMessage.length > MAX_MESSAGE_LENGTH) {
      toast.error(`Message too long. Maximum ${MAX_MESSAGE_LENGTH.toLocaleString()} characters allowed.`);
      return;
    }

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

      // Extract config fields from the generated Selenium script so the Run form matches it
      const fields = extractRunConfigFields(pythonScript || "");
      setRunConfigFields(fields);
      const initialValues: RunConfigValues = {};
      fields.forEach((field) => {
        initialValues[field.name] = field.defaultValue ?? "";
      });
      setRunConfig(initialValues);

      setGeneratedScripts({ python: pythonScript, playwright: playwrightScript });

      const contextInfo = sopContext
        ? " I used your uploaded SOP documents as additional context."
        : "";

      const assistantMessage = {
        role: "assistant" as const,
        content:
          "I've generated a Python script for your automation workflow. Check the code panel below to view, copy, or download it! When you're ready, click Run and I'll ask for the configuration values needed to execute it in the cloud.",
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

  const handleRunRequestedFromViewer = () => {
    if (!generatedScripts?.python) {
      toast.error("No Selenium script available to run.");
      return;
    }

    setPendingRunCode(generatedScripts.python);
    setRunOutput(null);

    setRunStep("collecting");
    setMessages((prev) => [
      ...prev,
      {
        role: "assistant" as const,
        content:
          "To run this Selenium script in the cloud/backend, please fill in the Required Configs form below and click Submit.",
      },
    ]);
  };

  return (
    <div className="h-[calc(100vh-12rem)] flex gap-4 overflow-x-hidden overflow-y-auto">
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
            // Only disable while an upload is actively processing
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

        {/* Required Configs form for cloud run */}
        {runStep === "collecting" && (
          <Card className="mt-2 bg-card/60 border-border/60 p-4 space-y-3">
            <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
              <h3 className="text-sm font-semibold">Required Configs</h3>
              <p className="text-[11px] text-muted-foreground">
                These values will be injected into the generated Selenium script when running in the cloud/backend.
              </p>
            </div>
            <form className="space-y-3" onSubmit={handleSubmitRunConfig}>
              {/* Buttons first so they are always visible at the top of the card */}
              <div className="flex gap-2 justify-end">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleCancelRunConfig}
                  disabled={isRunExecuting}
                >
                  Cancel
                </Button>
                <Button type="submit" variant="premium" size="sm" disabled={isRunExecuting}>
                  {isRunExecuting ? "Running..." : "Submit & Run"}
                </Button>
              </div>

              <div className="space-y-3">
                {runConfigFields.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No configuration constants were detected in this script.
                  </p>
                ) : (
                  runConfigFields.map((field) => (
                    <div key={field.name} className="space-y-1">
                      <Label htmlFor={`config-${field.name}`} className="text-xs">
                        {field.name}
                      </Label>
                      <Input
                        id={`config-${field.name}`}
                        placeholder={field.defaultValue || "Enter value"}
                        value={runConfig[field.name] ?? ""}
                        onChange={(e) =>
                          setRunConfig((prev) => ({ ...prev, [field.name]: e.target.value }))
                        }
                        className="h-8 text-xs"
                      />
                    </div>
                  ))
                )}
              </div>
            </form>
          </Card>
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
      <div className="flex-1 min-h-0 flex flex-col gap-3">
        {generatedScripts ? (
          <>
            <CodeViewer
              pythonCode={generatedScripts.python}
              playwrightCode={generatedScripts.playwright ?? undefined}
              onRunRequested={handleRunRequestedFromViewer}
              isRunning={isRunExecuting}
              runOutput={runOutput}
            />
            {latestScreenshotUrl && (
              <Card className="bg-card/50 backdrop-blur-sm border-border/50 overflow-hidden">
                <div className="p-3 border-b border-border/40 flex items-center justify-between">
                  <span className="text-xs font-semibold">Latest Cloud Screenshot</span>
                  <Badge variant="outline" className="text-[10px]">
                    Live from backend run
                  </Badge>
                </div>
                <div className="max-h-[320px] overflow-auto bg-background flex items-center justify-center">
                  <img
                    src={latestScreenshotUrl}
                    alt="Latest Selenium cloud run screenshot"
                    className="max-h-[300px] w-full object-contain"
                  />
                </div>
              </Card>
            )}
          </>
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
