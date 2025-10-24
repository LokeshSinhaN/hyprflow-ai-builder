import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileCode, Play, Trash2, Clock } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";
import { CodeViewer } from "./CodeViewer";
import { generatePythonScript } from "@/utils/scriptGenerator";

const sampleWorkflows = [
  {
    id: 1,
    name: "Patient Registration",
    description: "Automated patient registration workflow with validation and MRN generation",
    createdAt: "2 days ago",
    language: "Python",
    category: "Front Office",
    keyword: "patient registration"
  },
  {
    id: 2,
    name: "Insurance Verification",
    description: "Verify patient insurance eligibility and coverage details in real-time",
    createdAt: "1 week ago",
    language: "Python",
    category: "Revenue Cycle",
    keyword: "insurance verification"
  },
  {
    id: 3,
    name: "Claims Submission",
    description: "Format and submit insurance claims electronically to clearinghouse",
    createdAt: "3 days ago",
    language: "Python",
    category: "Revenue Cycle",
    keyword: "claims submission"
  },
  {
    id: 4,
    name: "Payment Posting",
    description: "Post insurance payments and adjustments to patient accounts",
    createdAt: "5 days ago",
    language: "Python",
    category: "Revenue Cycle",
    keyword: "payment posting"
  },
  {
    id: 5,
    name: "Lab Order Processing",
    description: "Manage specimen collection, tracking, and automated result reporting",
    createdAt: "1 week ago",
    language: "Python",
    category: "Clinical Lab",
    keyword: "lab order processing"
  },
  {
    id: 6,
    name: "Appointment Scheduling",
    description: "Automated appointment booking with provider availability checking",
    createdAt: "4 days ago",
    language: "Python",
    category: "Front Office",
    keyword: "appointment scheduling"
  },
  {
    id: 7,
    name: "Data Processing Pipeline",
    description: "Automated data extraction and transformation from Excel files",
    createdAt: "2 weeks ago",
    language: "Python",
    category: "General",
    keyword: "data processing"
  },
  {
    id: 8,
    name: "Email Automation",
    description: "Send personalized emails based on spreadsheet data",
    createdAt: "1 week ago",
    language: "Python",
    category: "General",
    keyword: "email automation"
  },
];

export const WorkflowLibrary = () => {
  const [selectedWorkflow, setSelectedWorkflow] = useState<{ name: string; code: string } | null>(null);

  const handleRegenerate = (name: string, keyword: string) => {
    const generatedCode = generatePythonScript(keyword);
    setSelectedWorkflow({ name, code: generatedCode });
    toast.success(`Generated script for: ${name}`);
  };

  const handleDelete = (name: string) => {
    toast.success(`Deleted workflow: ${name}`);
  };

  const handleCloseViewer = () => {
    setSelectedWorkflow(null);
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

      {selectedWorkflow ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-semibold">{selectedWorkflow.name}</h2>
            <Button variant="outline" onClick={handleCloseViewer}>
              Back to Library
            </Button>
          </div>
          <CodeViewer code={selectedWorkflow.code} language="python" />
        </div>
      ) : (
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
                    <span className="px-2 py-1 rounded-md bg-accent/10 text-accent font-medium">
                      {workflow.category}
                    </span>
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
                  onClick={() => handleRegenerate(workflow.name, workflow.keyword)}
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
      )}
    </div>
  );
};
