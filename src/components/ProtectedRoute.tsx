// Dev mode: authentication is disabled. This route simply renders its children.
export const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  return <>{children}</>;
};
