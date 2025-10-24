import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Copy, Download, Play } from "lucide-react";
import { toast } from "sonner";

interface CodeViewerProps {
  code: string;
  language?: string;
}

export const CodeViewer = ({ code, language = "python" }: CodeViewerProps) => {
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

  const handleRun = () => {
    toast.info("Script execution will be available with Lovable Cloud backend");
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
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
          <Button variant="outline" size="sm" onClick={handleRun}>
            <Play className="w-4 h-4" />
            Run
          </Button>
        </div>
      </div>

      <Card className="flex-1 p-0 overflow-hidden bg-card/50 backdrop-blur-sm border-border/50">
        <pre className="h-full overflow-auto p-6 text-sm">
          <code className="text-foreground font-mono leading-relaxed">{code}</code>
        </pre>
      </Card>
    </div>
  );
};
