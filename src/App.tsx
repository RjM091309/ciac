import React, { useState } from 'react';
import { AppLayout } from './layout/AppLayout';
import { Dashboard } from './components/dashboard/Dashboard';

// --- Types ---
type Role = 'admin' | 'officer' | 'proponent';

interface UserData {
  id: number;
  email: string;
  name: string;
  role: Role;
}

// --- Main App ---

export default function App() {
  const defaultUser: UserData = {
    id: 1,
    email: 'admin@bizreg.com',
    name: 'Admin Demo',
    role: 'admin',
  };

  const [user, setUser] = useState<UserData>(defaultUser);
  const [view, setView] = useState<'dashboard' | 'applications' | 'profile' | 'businesses'>('dashboard');

  return (
    <>
      <AppLayout view={view} onViewChange={setView} onLogout={() => setUser(defaultUser)}>
        {view === 'dashboard' ? <Dashboard /> : null}
      </AppLayout>
    </>
  );
}
