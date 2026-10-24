import { Link } from 'react-router';
import { ShieldAlert } from 'lucide-react';
import { Button, Card, EmptyState } from '../components/ui.jsx';

export default function ForbiddenPage() {
  return (
    <div className="mx-auto max-w-6xl">
      <Card>
        <EmptyState
          icon={ShieldAlert}
          title="You don't have access to this page"
          action={
            <Link to="/">
              <Button variant="secondary">Back to dashboard</Button>
            </Link>
          }
        >
          This area is for a different role. Ask your Admin if you think this is a mistake.
        </EmptyState>
      </Card>
    </div>
  );
}
