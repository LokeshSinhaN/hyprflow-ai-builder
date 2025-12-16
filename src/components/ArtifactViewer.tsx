import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Copy, Play, X } from "lucide-react";
import { toast } from "sonner";
import { Highlight, themes } from "prism-react-renderer";

export type Artifact = {
  content: string;
  language: string;
  version_id: string;
};

type ArtifactViewerProps = {
  artifact: Artifact;
  title?: string;
  versionLabel?: string;
  onRun?: () => void;
  onClose?: () => void;
};

export const ArtifactViewer = ({
  artifact,
  title = "Artifact",
  versionLabel,
  onRun,
  onClose,
}: ArtifactViewerProps) => {
  const handleCopy = () => {
    navigator.clipboard.writeText(artifact.content);
    toast.success("Code copied to clipboard!");
  };

  const handleRunClick = () => {
    if (!onRun) {
      toast.info(
        "Use this script by updating the placeholders at the top (driver path, URL, credentials) before running it locally.",
      );
      return;
    }

    onRun();
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="text-[10px] text-muted-foreground">Version {versionLabel ?? artifact.version_id}</p>
        </div>

        <div className="flex gap-2 items-center">
          {onClose && (
            <Button variant="ghost" size="sm" onClick={onClose}>
              <X className="w-4 h-4" />
              Close (X)
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={handleCopy}>
            <Copy className="w-4 h-4" />
            Copy
          </Button>
          <Button variant="premium" size="sm" onClick={handleRunClick}>
            <Play className="w-4 h-4" />
            Run
          </Button>
        </div>
      </div>

      <Card className="flex-1 min-h-0 overflow-hidden flex flex-col bg-[#1e1e1e] backdrop-blur-sm border-border/50">
        <div className="flex-1 min-h-0 overflow-auto">
          <Highlight theme={themes.vsDark} code={artifact.content} language={artifact.language as any}>
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
    </div>
  );
};