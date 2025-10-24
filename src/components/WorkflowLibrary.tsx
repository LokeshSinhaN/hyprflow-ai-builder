import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileCode, Play, Trash2, Clock } from "lucide-react";
import { toast } from "sonner";

const sampleWorkflows = [
  {
    id: 1,
    name: "Data Processing Pipeline",
    description: "Automated data extraction and transformation from Excel files",
    createdAt: "2 days ago",
    language: "Python",
  },
  {
    id: 2,
    name: "Email Automation",
    description: "Send personalized emails based on spreadsheet data",
    createdAt: "1 week ago",
    language: "Python",
  },
  {
    id: 3,
    name: "Report Generator",
    description: "Generate PDF reports from database queries",
    createdAt: "2 weeks ago",
    language: "Python",
  },
];

export const WorkflowLibrary = () => {
  const handleRegenerate = (name: string) => {
    toast.success(`Regenerating workflow: ${name}`);
  };

  const handleDelete = (name: string) => {
    toast.success(`Deleted workflow: ${name}`);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Workflow Library</h1>
          <p className="text-muted-foreground mt-1">
            Your saved automation scripts and workflows
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {sampleWorkflows.map((workflow) => (
          <Card
            key={workflow.id}
            className="p-6 bg-card/50 backdrop-blur-sm border-border/50 hover:border-accent/50 transition-all group"
          >
            <div className="flex items-start gap-4">
              <div className="p-3 rounded-lg bg-gradient-primary shadow-glow">
                <FileCode className="w-5 h-5 text-accent-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-lg truncate group-hover:text-accent transition-colors">
                  {workflow.name}
                </h3>
                <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                  {workflow.description}
                </p>
                <div className="flex items-center gap-2 mt-3 text-xs text-muted-foreground">
                  <Clock className="w-3 h-3" />
                  {workflow.createdAt}
                </div>
              </div>
            </div>

            <div className="flex gap-2 mt-4">
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={() => handleRegenerate(workflow.name)}
              >
                <Play className="w-3 h-3" />
                Regenerate
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleDelete(workflow.name)}
              >
                <Trash2 className="w-3 h-3" />
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
};
