import { Card } from "@/components/ui/card";
import { 
  TrendingUp, 
  CheckCircle2, 
  Play, 
  Pause, 
  AlertCircle,
  Target
} from "lucide-react";

const stats = [
  {
    label: "Total Projects",
    value: "24",
    change: "+12%",
    trend: "up",
    icon: Target,
    color: "text-blue-500"
  },
  {
    label: "Deployed",
    value: "18",
    change: "+8%",
    trend: "up",
    icon: CheckCircle2,
    color: "text-green-500"
  },
  {
    label: "Working",
    value: "4",
    change: "+2",
    trend: "up",
    icon: Play,
    color: "text-purple-500"
  },
  {
    label: "Paused",
    value: "1",
    change: "-1",
    trend: "down",
    icon: Pause,
    color: "text-yellow-500"
  },
  {
    label: "Stuck",
    value: "1",
    change: "0",
    trend: "neutral",
    icon: AlertCircle,
    color: "text-red-500"
  },
  {
    label: "Success Rate",
    value: "75%",
    change: "+5%",
    trend: "up",
    icon: TrendingUp,
    color: "text-accent"
  }
];

export const ProjectStats = () => {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      {stats.map((stat) => (
        <Card
          key={stat.label}
          className="p-6 bg-card/50 backdrop-blur-sm border-border/50 hover:border-accent/50 transition-all"
        >
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm text-muted-foreground font-medium">
                {stat.label}
              </p>
              <h3 className="text-3xl font-bold mt-2">{stat.value}</h3>
              <p className={`text-xs mt-2 ${
                stat.trend === 'up' ? 'text-green-500' : 
                stat.trend === 'down' ? 'text-red-500' : 
                'text-muted-foreground'
              }`}>
                {stat.change} from last month
              </p>
            </div>
            <div className={`p-3 rounded-lg bg-gradient-primary/10 ${stat.color}`}>
              <stat.icon className="w-5 h-5" />
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
};
