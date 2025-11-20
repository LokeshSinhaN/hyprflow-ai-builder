import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Copy, Download, Play } from "lucide-react";
import { toast } from "sonner";
import { Highlight, themes } from "prism-react-renderer";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface CodeViewerProps {
  code: string;
  language?: string;
}

export const CodeViewer = ({ code, language = "python" }: CodeViewerProps) => {
  // Parse code if it contains both Python and Playwright
  const hasBothScripts = code.includes("# Python Selenium Script") && code.includes("// Playwright Script");
  
  let pythonCode = code;
  let playwrightCode = "";
  
  if (hasBothScripts) {
    const parts = code.split("// Playwright Script");
    pythonCode = parts[0].replace("# Python Selenium Script\n", "").trim();
    playwrightCode = parts[1].trim();
  }

  const handleCopy = (scriptCode: string) => {
    navigator.clipboard.writeText(scriptCode);
    toast.success("Code copied to clipboard!");
  };

  const handleDownload = (scriptCode: string, extension: string, scriptType: string) => {
    const blob = new Blob([scriptCode], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `automation_script_${scriptType}.${extension}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("Script downloaded!");
  };

  const handleRun = () => {
    toast.info("Script execution will be available with Lovable Cloud backend");
  };


  const CodeBlock = ({ code: blockCode, lang }: { code: string; lang: string }) => (
    <Card className="flex-1 overflow-hidden bg-[#1e1e1e] backdrop-blur-sm border-border/50">
      <div className="h-full overflow-auto">
        <Highlight theme={themes.vsDark} code={blockCode} language={lang as any}>
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
  );

  if (!code || code === "Generated code will appear here...") {
    return (
      <div className="h-full flex flex-col">
        <h2 className="text-lg font-semibold mb-4">Generated Script</h2>
        <Card className="flex-1 flex items-center justify-center bg-card/30 backdrop-blur-sm border-border/50">
          <p className="text-muted-foreground">Generated code will appear here...</p>
        </Card>
      </div>
    );
  }

  if (hasBothScripts) {
    return (
      <div className="h-full flex flex-col">
        <h2 className="text-lg font-semibold mb-4">Generated Scripts</h2>
        <Tabs defaultValue="python" className="flex-1 flex flex-col">
          <TabsList className="mb-4">
            <TabsTrigger value="python">Python (Selenium)</TabsTrigger>
            <TabsTrigger value="playwright">Node.js (Playwright)</TabsTrigger>
          </TabsList>
          
          <TabsContent value="python" className="flex-1 flex flex-col mt-0">
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm text-muted-foreground">Python Selenium Script</span>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => handleCopy(pythonCode)}>
                  <Copy className="w-4 h-4" />
                  Copy
                </Button>
                <Button variant="ghost" size="sm" onClick={() => handleDownload(pythonCode, "py", "selenium")}>
                  <Download className="w-4 h-4" />
                  Download
                </Button>
                <Button variant="outline" size="sm" onClick={handleRun}>
                  <Play className="w-4 h-4" />
                  Run
                </Button>
              </div>
            </div>
            <CodeBlock code={pythonCode} lang="python" />
          </TabsContent>
          
          <TabsContent value="playwright" className="flex-1 flex flex-col mt-0">
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm text-muted-foreground">Node.js Playwright Script</span>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => handleCopy(playwrightCode)}>
                  <Copy className="w-4 h-4" />
                  Copy
                </Button>
                <Button variant="ghost" size="sm" onClick={() => handleDownload(playwrightCode, "js", "playwright")}>
                  <Download className="w-4 h-4" />
                  Download
                </Button>
                <Button variant="outline" size="sm" onClick={handleRun}>
                  <Play className="w-4 h-4" />
                  Run
                </Button>
              </div>
            </div>
            <CodeBlock code={playwrightCode} lang="javascript" />
          </TabsContent>
        </Tabs>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Generated Script</h2>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => handleCopy(code)}>
            <Copy className="w-4 h-4" />
            Copy
          </Button>
          <Button variant="ghost" size="sm" onClick={() => handleDownload(code, language === "python" ? "py" : "txt", "script")}>
            <Download className="w-4 h-4" />
            Download
          </Button>
          <Button variant="outline" size="sm" onClick={handleRun}>
            <Play className="w-4 h-4" />
            Run
          </Button>
        </div>
      </div>

      <CodeBlock code={code} lang={language} />
    </div>
  );
};
