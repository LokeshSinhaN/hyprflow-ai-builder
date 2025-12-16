import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export type ArtifactRef = {
  title: string;
  version_id: string;
  version_label: string;
};

type ArtifactCardProps = {
  artifact: ArtifactRef;
  onOpen: (versionId: string) => void;
};

export const ArtifactCard = ({ artifact, onOpen }: ArtifactCardProps) => {
  return (
    <Card className="mt-3 p-3 bg-card/30 border-border/50">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold truncate">{artifact.title}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">Version {artifact.version_label}</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 px-2 text-[10px]"
          onClick={() => onOpen(artifact.version_id)}
        >
          Open
        </Button>
      </div>
    </Card>
  );
};