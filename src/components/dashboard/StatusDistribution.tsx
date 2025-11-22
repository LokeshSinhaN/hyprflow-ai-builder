import { Card } from "@/components/ui/card";
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from "recharts";

const data = [
  { name: "Deployed", value: 18, color: "hsl(142, 76%, 36%)" },
  { name: "Working", value: 4, color: "hsl(271, 91%, 65%)" },
  { name: "Paused", value: 1, color: "hsl(48, 96%, 53%)" },
  { name: "Stuck", value: 1, color: "hsl(0, 84%, 60%)" },
];

export const StatusDistribution = () => {
  return (
    <Card className="p-6 bg-card/50 backdrop-blur-sm border-border/50">
      <div className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold">Status Distribution</h3>
          <p className="text-sm text-muted-foreground">
            Current breakdown of all automation projects
          </p>
        </div>
        <ResponsiveContainer width="100%" height={300}>
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              labelLine={false}
              label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
              outerRadius={80}
              fill="#8884d8"
              dataKey="value"
            >
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip 
              contentStyle={{ 
                backgroundColor: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "8px"
              }}
            />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
        
        {/* Actionable Insights */}
        <div className="border-t border-border/50 pt-4 space-y-2">
          <h4 className="text-sm font-semibold">Actionable Insights</h4>
          <ul className="text-xs text-muted-foreground space-y-1">
            <li>• 75% deployment success rate - Above target (70%)</li>
            <li>• 1 project stuck - Requires immediate attention</li>
            <li>• 4 projects in progress - On track for completion</li>
          </ul>
        </div>
      </div>
    </Card>
  );
};
