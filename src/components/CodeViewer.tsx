import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Copy, Download, Play, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Highlight, themes } from "prism-react-renderer";
import { supabase } from "@/integrations/supabase/client";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface CodeViewerProps {
  code: string;
  language?: string;
}

export const CodeViewer = ({ code, language = "python" }: CodeViewerProps) => {
  const [isRunning, setIsRunning] = useState(false);
  const [output, setOutput] = useState<{ stdout: string; stderr: string; error?: string } | null>(null);
  const [showOutput, setShowOutput] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    toast.success("Code copied to clipboard!");
  };

  const handleDownload = () => {
    const blob = new Blob([code], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `automation_script.${language === "python" ? "py" : "txt"}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("Script downloaded!");
  };

  const handleRun = async () => {
    setIsRunning(true);
    setOutput(null);
    setShowOutput(true);
    
    try {
      const { data, error } = await supabase.functions.invoke('execute-python', {
        body: { code }
      });

      if (error) throw error;

      if (data.error) {
        setOutput({
          stdout: data.stdout || '',
          stderr: data.stderr || '',
          error: data.error
        });
        toast.error("Script execution failed");
      } else {
        setOutput({
          stdout: data.stdout || '',
          stderr: data.stderr || ''
        });
        toast.success("Script executed successfully!");
      }
    } catch (error) {
      console.error("Error running script:", error);
      setOutput({
        stdout: '',
        stderr: '',
        error: error instanceof Error ? error.message : "Failed to execute script"
      });
      toast.error("Failed to execute script");
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="h-full flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Generated Script</h2>
        <div className="flex gap-2">
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
            onClick={handleRun}
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
          <Highlight theme={themes.vsDark} code={code} language={language as any}>
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

      {output && (
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
                {output.error && (
                  <div className="space-y-2">
                    <h3 className="text-sm font-semibold text-destructive">Error:</h3>
                    <pre className="text-xs bg-destructive/10 text-destructive p-3 rounded-md overflow-x-auto">
                      {output.error}
                    </pre>
                  </div>
                )}
                {output.stdout && (
                  <div className="space-y-2">
                    <h3 className="text-sm font-semibold text-green-500">Output:</h3>
                    <pre className="text-xs bg-card/50 p-3 rounded-md overflow-x-auto text-muted-foreground">
                      {output.stdout}
                    </pre>
                  </div>
                )}
                {output.stderr && (
                  <div className="space-y-2">
                    <h3 className="text-sm font-semibold text-yellow-500">Warnings/Errors:</h3>
                    <pre className="text-xs bg-yellow-500/10 text-yellow-500 p-3 rounded-md overflow-x-auto">
                      {output.stderr}
                    </pre>
                  </div>
                )}
                {!output.stdout && !output.stderr && !output.error && (
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
