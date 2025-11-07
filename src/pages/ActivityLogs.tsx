import { Layout } from "@/components/Layout";
import { useAuth } from "@/hooks/useAuth";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { format } from "date-fns";
import { Search, Activity, User, CheckCircle, XCircle, MessageSquare } from "lucide-react";

interface ActivityLog {
  id: string;
  user_id: string;
  activity_type: string;
  activity_description: string;
  metadata: any;
  created_at: string;
  user_name?: string;
  user_email?: string;
}

const ActivityLogs = () => {
  const { isAdmin } = useAuth();
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterType, setFilterType] = useState<string>("all");

  useEffect(() => {
    if (isAdmin) {
      fetchLogs();
    }
  }, [isAdmin]);

  const fetchLogs = async () => {
    try {
      const { data: logsData, error: logsError } = await supabase
        .from("user_activity_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);

      if (logsError) throw logsError;

      // Fetch user profiles separately
      const userIds = [...new Set(logsData.map(log => log.user_id))];
      const { data: profiles, error: profilesError } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .in("id", userIds);

      if (profilesError) throw profilesError;

      // Merge the data
      const enrichedLogs = logsData.map(log => {
        const profile = profiles.find(p => p.id === log.user_id);
        return {
          ...log,
          user_name: profile?.full_name || "Unknown",
          user_email: profile?.email || ""
        };
      });

      setLogs(enrichedLogs);
    } catch (error: any) {
      toast.error("Failed to fetch activity logs");
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const getActivityIcon = (type: string) => {
    switch (type) {
      case "user_login":
        return <User className="h-4 w-4" />;
      case "user_approved":
        return <CheckCircle className="h-4 w-4" />;
      case "user_rejected":
        return <XCircle className="h-4 w-4" />;
      case "conversation_created":
        return <MessageSquare className="h-4 w-4" />;
      default:
        return <Activity className="h-4 w-4" />;
    }
  };

  const getActivityColor = (type: string) => {
    switch (type) {
      case "user_login":
        return "default";
      case "user_approved":
        return "success";
      case "user_rejected":
        return "destructive";
      case "conversation_created":
        return "secondary";
      default:
        return "outline";
    }
  };

  const filteredLogs = logs.filter((log) => {
    const matchesSearch =
      log.user_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.user_email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.activity_description?.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesFilter = filterType === "all" || log.activity_type === filterType;

    return matchesSearch && matchesFilter;
  });

  const activityTypes = [...new Set(logs.map((log) => log.activity_type))];

  if (!isAdmin) {
    return (
      <Layout>
        <div className="text-center py-12">
          <p className="text-muted-foreground">You don't have permission to view this page.</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Activity Logs</h1>
          <p className="text-muted-foreground mt-1">
            Monitor user activities and system events
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>User Activity Tracking</CardTitle>
            <CardDescription>
              View and filter all user activities across the platform
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col sm:flex-row gap-4 mb-6">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by user or description..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
              <Select value={filterType} onValueChange={setFilterType}>
                <SelectTrigger className="w-full sm:w-[200px]">
                  <SelectValue placeholder="Filter by type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Activities</SelectItem>
                  {activityTypes.map((type) => (
                    <SelectItem key={type} value={type}>
                      {type.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {loading ? (
              <div className="text-center py-8">
                <p className="text-muted-foreground">Loading activity logs...</p>
              </div>
            ) : filteredLogs.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-muted-foreground">No activity logs found</p>
              </div>
            ) : (
              <div className="border rounded-lg">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>User</TableHead>
                      <TableHead>Activity</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Date & Time</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredLogs.map((log) => (
                      <TableRow key={log.id}>
                        <TableCell>
                          <div>
                            <div className="font-medium">{log.user_name}</div>
                            <div className="text-sm text-muted-foreground">{log.user_email}</div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={getActivityColor(log.activity_type) as any} className="flex items-center gap-1 w-fit">
                            {getActivityIcon(log.activity_type)}
                            {log.activity_type.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())}
                          </Badge>
                        </TableCell>
                        <TableCell>{log.activity_description}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {format(new Date(log.created_at), "MMM dd, yyyy 'at' h:mm a")}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
};

export default ActivityLogs;
