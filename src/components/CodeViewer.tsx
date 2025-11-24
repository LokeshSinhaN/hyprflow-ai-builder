import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Copy, Download, Play, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Highlight, themes } from "prism-react-renderer";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

interface RunOutput {
  stdout: string;
  stderr: string;
  error?: string;
}

interface CodeViewerProps {
  pythonCode: string;
  playwrightCode?: string | null;
  onRunRequested?: () => void;
  isRunning?: boolean;
  runOutput?: RunOutput | null;
}

export const CodeViewer = ({
  pythonCode,
  playwrightCode,
  onRunRequested,
  isRunning = false,
  runOutput = null,
}: CodeViewerProps) => {
  const [activeTab, setActiveTab] = useState<"python" | "playwright">("python");
  const [showOutput, setShowOutput] = useState(false);

  const currentCode =
    activeTab === "python"
      ? pythonCode
      : playwrightCode || "# Playwright Python script is not available for this SOP.\n";

  // Both scripts are Python (Selenium & Playwright)
  const currentLanguage = "python";

  const handleCopy = () => {
    navigator.clipboard.writeText(currentCode);
    toast.success("Code copied to clipboard!");
  };

  const handleDownload = () => {
    const filename =
      activeTab === "python" ? "automation_script_selenium.py" : "automation_script_playwright.py";
    const blob = new Blob([currentCode], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("Script downloaded!");
  };

  const handleRunClick = () => {
    if (activeTab !== "python") {
      toast.error("Cloud run is only available for the Selenium Python script. Switch to the Python tab to run.");
      return;
    }

    if (!onRunRequested) {
      toast.error("Run handler is not configured.");
      return;
    }

    setShowOutput(true);
    onRunRequested();
  };

  return (
    <div className="h-full flex flex-col gap-4">
      {/* Header: title, language tabs, and actions all in a single flex row that can wrap */}
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold mr-1">Generated Scripts</h2>

        {/* Language tabs */}
        <div className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-card/60 px-1 py-0.5 shadow-sm">
          <Button
            type="button"
            variant={activeTab === "python" ? "secondary" : "ghost"}
            size="sm"
            className={cn(
              "h-8 rounded-full px-3 text-xs font-medium transition-all",
              activeTab === "python"
                ? "bg-gradient-to-r from-accent to-primary text-primary-foreground shadow"
                : "text-muted-foreground hover:text-foreground"
            )}
            onClick={() => setActiveTab("python")}
          >
            Python (Selenium)
          </Button>
          <Button
            type="button"
            variant={activeTab === "playwright" ? "secondary" : "ghost"}
            size="sm"
            className={cn(
              "h-8 rounded-full px-3 text-xs font-medium transition-all",
              activeTab === "playwright"
                ? "bg-gradient-to-r from-accent to-primary text-primary-foreground shadow"
                : "text-muted-foreground hover:text-foreground",
              !playwrightCode && "opacity-60 cursor-not-allowed"
            )}
            onClick={() => playwrightCode && setActiveTab("playwright")}
            disabled={!playwrightCode}
          >
            Python (Playwright)
          </Button>
        </div>

        {/* Actions: directly after tabs, wrap onto next line if necessary */}
        <div className="flex gap-2 items-center flex-wrap ml-2">
          <Button variant="ghost" size="sm" onClick={handleCopy}>
            <Copy className="w-4 h-4" />
            Copy
          </Button>
          <Button variant="ghost" size="sm" onClick={handleDownload}>
            <Download className="w-4 h-4" />
            Download
          </Button>
          <Button
            variant="premium"
            size="sm"
            onClick={handleRunClick}
            disabled={isRunning}
          >
            {isRunning ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Play className="w-4 h-4" />
            )}
            {isRunning ? "Running..." : "Run"}
          </Button>
        </div>
      </div>

      <Card className="flex-1 overflow-hidden bg-[#1e1e1e] backdrop-blur-sm border-border/50">
        <div className="h-full overflow-auto">
          <Highlight theme={themes.vsDark} code={currentCode} language={currentLanguage as any}>
            {({ style, tokens, getLineProps, getTokenProps }) => (
              <pre style={{ ...style, margin: 0, padding: "1.5rem", background: "transparent" }}>
                {tokens.map((line, i) => (
                  <div key={i} {...getLineProps({ line })} style={{ display: "table-row" }}>
                    <span
                      style={{
                        display: "table-cell",
                        textAlign: "right",
                        paddingRight: "1em",
                        userSelect: "none",
                        opacity: 0.5,
                        fontSize: "0.875rem",
                      }}
                    >
                      {i + 1}
                    </span>
                    <span style={{ display: "table-cell", fontSize: "0.875rem" }}>
                      {line.map((token, key) => (
                        <span key={key} {...getTokenProps({ token })} />
                      ))}
                    </span>
                  </div>
                ))}
              </pre>
            )}
          </Highlight>
        </div>
      </Card>

      {runOutput && (
        <Collapsible open={showOutput} onOpenChange={setShowOutput}>
          <Card className="bg-card/50 backdrop-blur-sm border-border/50">
            <CollapsibleTrigger asChild>
              <Button variant="ghost" className="w-full justify-between p-4">
                <span className="font-semibold">Execution Output</span>
                {showOutput ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="p-4 pt-0 space-y-3">
                {runOutput.error && (
                  <div className="space-y-2">
                    <h3 className="text-sm font-semibold text-destructive">Error:</h3>
                    <pre className="text-xs bg-destructive/10 text-destructive p-3 rounded-md overflow-x-auto">
                      {runOutput.error}
                    </pre>
                  </div>
                )}
                {runOutput.stdout && (
                  <div className="space-y-2">
                    <h3 className="text-sm font-semibold text-green-500">Output:</h3>
                    <pre className="text-xs bg-card/50 p-3 rounded-md overflow-x-auto text-muted-foreground">
                      {runOutput.stdout}
                    </pre>
                  </div>
                )}
                {runOutput.stderr && (
                  <div className="space-y-2">
                    <h3 className="text-sm font-semibold text-yellow-500">Warnings/Errors:</h3>
                    <pre className="text-xs bg-yellow-500/10 text-yellow-500 p-3 rounded-md overflow-x-auto">
                      {runOutput.stderr}
                    </pre>
                  </div>
                )}
                {!runOutput.stdout && !runOutput.stderr && !runOutput.error && (
                  <p className="text-sm text-muted-foreground">No output</p>
                )}
              </div>
            </CollapsibleContent>
          </Card>
        </Collapsible>
      )}
    </div>
  );
};
