import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Shield, FileText, Lock, Users, Clock, AlertTriangle, Mail, ArrowLeft, ExternalLink, CheckCircle2,
} from 'lucide-react';

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background text-foreground py-8 px-4 sm:px-6 lg:px-8 max-w-4xl mx-auto space-y-8">
      {/* Navigation Header */}
      <div className="flex items-center justify-between border-b pb-4">
        <Link to="/" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4" /> Back to Application
        </Link>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-2xs font-mono">RA 10173 (DPA 2012)</Badge>
          <Badge className="bg-primary/20 text-primary border-primary/30 text-2xs font-mono">v2026-10</Badge>
        </div>
      </div>

      {/* Hero Title */}
      <div className="space-y-2">
        <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-primary-soft text-primary text-xs font-medium">
          <Shield className="h-3.5 w-3.5" /> Data Privacy &amp; Protection Notice
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
          Privacy Notice for PWRI Plant Monitoring Platform
        </h1>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Pilipinas Water Resources, Inc. (&ldquo;PWRI&rdquo;, &ldquo;Company&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;) is committed to protecting the privacy and confidentiality of personal data in compliance with Republic Act No. 10173, otherwise known as the <strong>Philippine Data Privacy Act of 2012 (DPA 2012)</strong>, its Implementing Rules and Regulations (IRR), and issuances by the National Privacy Commission (NPC).
        </p>
      </div>

      {/* Main Content Cards */}
      <div className="space-y-6 text-xs sm:text-sm text-muted-foreground leading-relaxed">
        
        {/* Section 1: Scope */}
        <Card className="p-5 sm:p-6 space-y-3">
          <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" /> 1. Scope &amp; Applicability
          </h2>
          <p>
            This Privacy Notice applies to all authorized employees, operators, plant technicians, managers, and contractors accessing or operating the PWRI Plant Monitoring &amp; Industrial Intelligence Web/PWA Application across all assigned regional facilities and reverse osmosis (RO) plants.
          </p>
        </Card>

        {/* Section 2: Data We Collect */}
        <Card className="p-5 sm:p-6 space-y-3">
          <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" /> 2. Personal Data We Collect
          </h2>
          <p>We collect and process only the minimum information necessary to execute operational monitoring and meet regulatory standards:</p>
          <ul className="list-disc pl-5 space-y-1.5 text-xs">
            <li><strong>Identity &amp; Account Information:</strong> Full name (first name, middle name, last name, suffix), employee username, company email address, job title/designation, and assigned facility list.</li>
            <li><strong>Operational Audit Log Records:</strong> Timestamps of submitted plant readings, meter replacements, data correction requests, approval logs, and system actions (`user_id` linkage).</li>
            <li><strong>Technical &amp; Device Telemetry:</strong> Device category (mobile vs desktop), browser type, and high-level normalized screen navigation patterns (`nav_page_views`) to improve platform usability. Plant IDs, specific readings, and user credentials are never logged in navigation analytics.</li>
            <li><strong>Push Notification Endpoints:</strong> Browser push subscriptions if explicitly opted-in for emergency plant alerts.</li>
          </ul>
        </Card>

        {/* Section 3: Legal Basis & Purpose */}
        <Card className="p-5 sm:p-6 space-y-3">
          <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-primary" /> 3. Legal Basis and Purposes of Processing
          </h2>
          <p>We process your personal data under the following legitimate grounds:</p>
          <ul className="list-disc pl-5 space-y-1.5 text-xs">
            <li><strong>Fulfillment of Employment / Operations Contract:</strong> Enabling shift handovers, daily log validations, and accountability in facility maintenance.</li>
            <li><strong>Legal &amp; Regulatory Compliance:</strong> Fulfilling statutory water quality monitoring, reporting, and safety mandates under the Philippine National Standards for Drinking Water (PNSDW).</li>
            <li><strong>Security &amp; System Integrity:</strong> Monitoring authentication attempts, enforcing strict Role-Based Access Control (RBAC), and preventing unauthorized operational overrides.</li>
          </ul>
        </Card>

        {/* Section 4: Sub-processors & Data Transfer */}
        <Card className="p-5 sm:p-6 space-y-3">
          <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
            <Lock className="h-4 w-4 text-primary" /> 4. Sub-Processors &amp; Third-Party Services
          </h2>
          <p>Personal data is stored and processed with enterprise security safeguards:</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 text-xs">
            <div className="p-3 rounded-md border border-border bg-muted/20">
              <strong className="text-foreground block">Supabase Inc.</strong>
              <span>Cloud PostgreSQL Database and Auth provider. Data encrypted at rest and in transit via TLS 1.3 with Row-Level Security (RLS).</span>
            </div>
            <div className="p-3 rounded-md border border-border bg-muted/20">
              <strong className="text-foreground block">Sentry (Functional Error Monitoring)</strong>
              <span>Application crash diagnostics with strict Session Replay masking enabled (`maskAllText: true`, `blockAllMedia: true`).</span>
            </div>
          </div>
        </Card>

        {/* Section 5: Retention & Disposal */}
        <Card className="p-5 sm:p-6 space-y-3">
          <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
            <Clock className="h-4 w-4 text-primary" /> 5. Data Retention &amp; Disposal Policy
          </h2>
          <p>
            Operational readings and audit logs are retained for a minimum of <strong>five (5) years</strong> to comply with national drinking water quality standards and regulatory audit schedules.
          </p>
          <p>
            Upon termination of employment, user accounts are pseudonymized (preserving historical log integrity without retaining active personal identifiers). Anonymous navigation telemetry is automatically pruned on a <strong>90-day</strong> rolling schedule.
          </p>
        </Card>

        {/* Section 6: Data Subject Rights */}
        <Card className="p-5 sm:p-6 space-y-3">
          <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" /> 6. Your Rights as a Data Subject (RA 10173 Sec. 16)
          </h2>
          <p>Under the Data Privacy Act of 2012, you possess the following rights:</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 text-xs">
            <div>• <strong>Right to be Informed:</strong> Transparent notice of how data is used.</div>
            <div>• <strong>Right to Access &amp; Portability:</strong> Self-service &ldquo;Download My Data&rdquo; via the Profile page.</div>
            <div>• <strong>Right to Rectification:</strong> Correction of inaccurate profile data.</div>
            <div>• <strong>Right to Object / Opt-out:</strong> Local opt-out toggle and Do Not Track (DNT) honoring for analytics.</div>
          </div>
        </Card>

        {/* Section 7: DPO Contact */}
        <Card className="p-5 sm:p-6 space-y-3 bg-primary-soft/30 border-primary/20">
          <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
            <Mail className="h-4 w-4 text-primary" /> 7. Data Protection Officer (DPO) Contact
          </h2>
          <p>
            For privacy inquiries, rights enforcement requests, or reporting security incidents, please contact the designated Data Protection Officer:
          </p>
          <div className="p-3.5 rounded-md bg-card border text-xs space-y-1.5">
            <p className="font-semibold text-foreground">Data Protection Officer — Pilipinas Water Resources, Inc. (PWRI)</p>
            <p>Email: <a href="mailto:dpo@pwri.com.ph" className="text-primary hover:underline font-mono">dpo@pwri.com.ph</a></p>
            <p>Address: Cebu South Coastal Road, Cogon Pardo, 6000 Cebu City, Philippines</p>
            <p>Website: <a href="https://www.pilipinaswater.com.ph/" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline font-mono inline-flex items-center gap-1">https://www.pilipinaswater.com.ph/ <ExternalLink className="h-2.5 w-2.5" /></a></p>
          </div>
        </Card>
      </div>

      {/* Footer Links */}
      <div className="pt-6 border-t flex flex-wrap items-center justify-between gap-4 text-xs text-muted-foreground">
        <p>&copy; {new Date().getFullYear()} Pilipinas Water Resources, Inc. (PWRI). All rights reserved.</p>
        <div className="flex items-center gap-4">
          <Link to="/terms" className="hover:text-primary transition-colors">Terms of Use</Link>
          <Link to="/privacy" className="hover:text-primary transition-colors font-semibold text-foreground">Privacy Notice</Link>
          <Link to="/help" className="hover:text-primary transition-colors">User Manual</Link>
        </div>
      </div>
    </div>
  );
}
