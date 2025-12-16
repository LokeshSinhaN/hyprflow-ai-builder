import { Layout } from "@/components/Layout";
import { ChatInterface } from "@/components/ChatInterface";

const Index = () => {
  return (
    <Layout fullWidth>
      {/* Full-height conversational workspace: chat + code only */}
      <ChatInterface />
    </Layout>
  );
};

export default Index;
