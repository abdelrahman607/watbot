import ApiOnlyDashboard from '../../components/ApiOnlyDashboard';
import EmailDashboard from '../../components/EmailDashboard';

export default function DashboardPage() {
    if (process.env.SENDSTACK_API_ONLY === '1') {
        return <ApiOnlyDashboard />;
    }

    return (
        <div className="page-wrapper">
            <main className="page-content">
                <EmailDashboard />
            </main>
        </div>
    );
}
