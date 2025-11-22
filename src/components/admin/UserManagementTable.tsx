import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { CheckCircle, XCircle, Clock } from "lucide-react";

interface Profile {
  id: string;
  email: string;
  full_name: string;
  approved: boolean;
  created_at: string;
  approved_at: string | null;
}

export const UserManagementTable = () => {
  const [users, setUsers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingUsers, setProcessingUsers] = useState<Set<string>>(new Set());

  const fetchUsers = async () => {
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      setUsers(data || []);
    } catch (error: any) {
      console.error("Error fetching users:", error);
      toast.error("Failed to load users");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();

    // Set up real-time subscription
    const channel = supabase
      .channel("profiles-changes")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "profiles",
        },
        () => {
          fetchUsers();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const handleApproveUser = async (userId: string, approved: boolean) => {
    setProcessingUsers((prev) => new Set(prev).add(userId));
    
    try {
      const { error } = await supabase.functions.invoke("approve-user", {
        body: { userId, approved },
      });

      if (error) throw error;

      toast.success(
        approved ? "User approved successfully" : "User rejected successfully"
      );
      fetchUsers();
    } catch (error: any) {
      console.error("Error updating user:", error);
      toast.error("Failed to update user status");
    } finally {
      setProcessingUsers((prev) => {
        const next = new Set(prev);
        next.delete(userId);
        return next;
      });
    }
  };

  const pendingUsers = users.filter((u) => !u.approved);
  const approvedUsers = users.filter((u) => u.approved);

  const UserTable = ({ users: tableUsers }: { users: Profile[] }) => (
    <div className="border rounded-lg">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Registered</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tableUsers.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-muted-foreground">
                No users found
              </TableCell>
            </TableRow>
          ) : (
            tableUsers.map((user) => (
              <TableRow key={user.id}>
                <TableCell className="font-medium">
                  {user.full_name || "N/A"}
                </TableCell>
                <TableCell>{user.email}</TableCell>
                <TableCell>
                  {user.approved ? (
                    <Badge variant="default" className="gap-1">
                      <CheckCircle className="w-3 h-3" />
                      Approved
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="gap-1">
                      <Clock className="w-3 h-3" />
                      Pending
                    </Badge>
                  )}
                </TableCell>
                <TableCell>
                  {new Date(user.created_at).toLocaleDateString()}
                </TableCell>
                <TableCell className="text-right">
                  {!user.approved ? (
                    <div className="flex gap-2 justify-end">
                      <Button
                        size="sm"
                        onClick={() => handleApproveUser(user.id, true)}
                        disabled={processingUsers.has(user.id)}
                        className="gap-1"
                      >
                        <CheckCircle className="w-4 h-4" />
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleApproveUser(user.id, false)}
                        disabled={processingUsers.has(user.id)}
                        className="gap-1"
                      >
                        <XCircle className="w-4 h-4" />
                        Reject
                      </Button>
                    </div>
                  ) : (
                    <Badge variant="outline" className="gap-1">
                      <CheckCircle className="w-3 h-3" />
                      Active
                    </Badge>
                  )}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent"></div>
      </div>
    );
  }

  return (
    <Tabs defaultValue="pending" className="w-full">
      <TabsList>
        <TabsTrigger value="pending">
          Pending ({pendingUsers.length})
        </TabsTrigger>
        <TabsTrigger value="approved">
          Approved ({approvedUsers.length})
        </TabsTrigger>
        <TabsTrigger value="all">All Users ({users.length})</TabsTrigger>
      </TabsList>
      <TabsContent value="pending" className="mt-4">
        <UserTable users={pendingUsers} />
      </TabsContent>
      <TabsContent value="approved" className="mt-4">
        <UserTable users={approvedUsers} />
      </TabsContent>
      <TabsContent value="all" className="mt-4">
        <UserTable users={users} />
      </TabsContent>
    </Tabs>
  );
};
