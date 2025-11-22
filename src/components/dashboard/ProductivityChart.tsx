import { Card } from "@/components/ui/card";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";

const data = [
  { month: "Jan", deployed: 2, working: 1, paused: 0, stuck: 0 },
  { month: "Feb", deployed: 3, working: 2, paused: 1, stuck: 0 },
  { month: "Mar", deployed: 5, working: 1, paused: 0, stuck: 1 },
  { month: "Apr", deployed: 4, working: 3, paused: 0, stuck: 0 },
  { month: "May", deployed: 6, working: 2, paused: 1, stuck: 0 },
  { month: "Jun", deployed: 7, working: 4, paused: 1, stuck: 1 },
];

export const ProductivityChart = () => {
  return (
    <Card className="p-6 bg-card/50 backdrop-blur-sm border-border/50">
      <div className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold">Productivity Trend</h3>
          <p className="text-sm text-muted-foreground">
            Monthly project completion and status over time
          </p>
        </div>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" />
            <XAxis 
              dataKey="month" 
              className="text-xs"
              stroke="hsl(var(--muted-foreground))"
            />
            <YAxis 
              className="text-xs"
              stroke="hsl(var(--muted-foreground))"
            />
            <Tooltip 
              contentStyle={{ 
                backgroundColor: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "8px"
              }}
            />
            <Legend />
            <Line 
              type="monotone" 
              dataKey="deployed" 
              stroke="hsl(142, 76%, 36%)" 
              strokeWidth={2}
              name="Deployed"
            />
            <Line 
              type="monotone" 
              dataKey="working" 
              stroke="hsl(271, 91%, 65%)" 
              strokeWidth={2}
              name="Working"
            />
            <Line 
              type="monotone" 
              dataKey="paused" 
              stroke="hsl(48, 96%, 53%)" 
              strokeWidth={2}
              name="Paused"
            />
            <Line 
              type="monotone" 
              dataKey="stuck" 
              stroke="hsl(0, 84%, 60%)" 
              strokeWidth={2}
              name="Stuck"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
};
