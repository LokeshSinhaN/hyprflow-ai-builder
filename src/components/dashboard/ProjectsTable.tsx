import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ExternalLink, TrendingUp, TrendingDown, Minus } from "lucide-react";

const projects = [
  {
    id: 1,
    name: "Patient Registration Automation",
    category: "Front Office",
    status: "Deployed",
    progress: 100,
    createdDate: "2024-12-15",
    deployedDate: "2025-01-10",
    successRate: 98,
    trend: "up"
  },
  {
    id: 2,
    name: "Insurance Verification System",
    category: "Revenue Cycle",
    status: "Deployed",
    progress: 100,
    createdDate: "2024-12-20",
    deployedDate: "2025-01-15",
    successRate: 95,
    trend: "up"
  },
  {
    id: 3,
    name: "Claims Processing Pipeline",
    category: "Revenue Cycle",
    status: "Working",
    progress: 75,
    createdDate: "2025-01-05",
    deployedDate: null,
    successRate: null,
    trend: "neutral"
  },
  {
    id: 4,
    name: "Lab Order Management",
    category: "Clinical Lab",
    status: "Working",
    progress: 60,
    createdDate: "2025-01-10",
    deployedDate: null,
    successRate: null,
    trend: "neutral"
  },
  {
    id: 5,
    name: "Appointment Scheduling Bot",
    category: "Front Office",
    status: "Paused",
    progress: 45,
    createdDate: "2024-12-28",
    deployedDate: null,
    successRate: null,
    trend: "down"
  },
  {
    id: 6,
    name: "Payment Posting Automation",
    category: "Revenue Cycle",
    status: "Stuck",
    progress: 30,
    createdDate: "2025-01-01",
    deployedDate: null,
    successRate: null,
    trend: "down"
  },
  {
    id: 7,
    name: "Medical Records Digitization",
    category: "General",
    status: "Deployed",
    progress: 100,
    createdDate: "2024-11-20",
    deployedDate: "2024-12-30",
    successRate: 92,
    trend: "neutral"
  },
  {
    id: 8,
    name: "Billing Reconciliation",
    category: "Revenue Cycle",
    status: "Working",
    progress: 85,
    createdDate: "2025-01-08",
    deployedDate: null,
    successRate: null,
    trend: "up"
  },
];

const getStatusColor = (status: string) => {
  switch (status) {
    case "Deployed":
      return "bg-green-500/10 text-green-500 border-green-500/20";
    case "Working":
      return "bg-purple-500/10 text-purple-500 border-purple-500/20";
    case "Paused":
      return "bg-yellow-500/10 text-yellow-500 border-yellow-500/20";
    case "Stuck":
      return "bg-red-500/10 text-red-500 border-red-500/20";
    default:
      return "bg-muted text-muted-foreground";
  }
};

export const ProjectsTable = () => {
  return (
    <Card className="p-6 bg-card/50 backdrop-blur-sm border-border/50">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold">All Projects</h3>
            <p className="text-sm text-muted-foreground">
              Complete overview of automation development projects
            </p>
          </div>
          <Button variant="outline" size="sm">
            Export Report
          </Button>
        </div>

        <div className="border border-border/50 rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead>Project Name</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Progress</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Deployed</TableHead>
                <TableHead>Success Rate</TableHead>
                <TableHead>Trend</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projects.map((project) => (
                <TableRow key={project.id} className="hover:bg-muted/20">
                  <TableCell className="font-medium">{project.name}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">
                      {project.category}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge className={getStatusColor(project.status)}>
                      {project.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-2 bg-muted rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-gradient-primary transition-all"
                          style={{ width: `${project.progress}%` }}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {project.progress}%
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {project.createdDate}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {project.deployedDate || "—"}
                  </TableCell>
                  <TableCell>
                    {project.successRate ? (
                      <span className="text-sm font-medium">
                        {project.successRate}%
                      </span>
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {project.trend === "up" && (
                      <TrendingUp className="w-4 h-4 text-green-500" />
                    )}
                    {project.trend === "down" && (
                      <TrendingDown className="w-4 h-4 text-red-500" />
                    )}
                    {project.trend === "neutral" && (
                      <Minus className="w-4 h-4 text-muted-foreground" />
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm">
                      <ExternalLink className="w-4 h-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {/* Summary Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4 border-t border-border/50">
          <div>
            <p className="text-xs text-muted-foreground">Avg. Time to Deploy</p>
            <p className="text-lg font-semibold mt-1">18 days</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Avg. Success Rate</p>
            <p className="text-lg font-semibold mt-1">95%</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Active Sprint</p>
            <p className="text-lg font-semibold mt-1">4 projects</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Completion Rate</p>
            <p className="text-lg font-semibold mt-1">75%</p>
          </div>
        </div>
      </div>
    </Card>
  );
};
