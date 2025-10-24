import { Layout } from "@/components/Layout";
import { ProjectStats } from "@/components/dashboard/ProjectStats";
import { ProductivityChart } from "@/components/dashboard/ProductivityChart";
import { ProjectsTable } from "@/components/dashboard/ProjectsTable";
import { StatusDistribution } from "@/components/dashboard/StatusDistribution";
import { useAuth } from "@/hooks/useAuth";

const Dashboard = () => {
  const { user } = useAuth();
  
  // For demo purposes, use "Karl" as the display name
  const displayName = "Karl";
  
  // Get current time for greeting
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">
            {greeting}, {displayName} 👋
          </h1>
          <p className="text-muted-foreground mt-1">
            Track your automation projects, productivity metrics, and success rates
          </p>
        </div>

        {/* Key Metrics */}
        <ProjectStats />

        {/* Charts Row */}
        <div className="grid gap-6 md:grid-cols-2">
          <ProductivityChart />
          <StatusDistribution />
        </div>

        {/* Projects Table */}
        <ProjectsTable />
      </div>
    </Layout>
  );
};

export default Dashboard;
