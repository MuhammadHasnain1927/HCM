import { Link } from 'react-router';
import { Compass } from 'lucide-react';
import { Button, Card, EmptyState } from '../components/ui.jsx';

export default function NotFoundPage() {
  return (
    <div className="mx-auto max-w-6xl">
      <Card>
        <EmptyState
          icon={Compass}
          title="Page not found"
          action={
            <Link to="/">
              <Button variant="secondary">Back to dashboard</Button>
            </Link>
          }
        >
          The page you are looking for does not exist.
        </EmptyState>
      </Card>
    </div>
  );
}
