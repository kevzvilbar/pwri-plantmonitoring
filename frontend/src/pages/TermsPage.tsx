import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  FileText, ShieldAlert, CheckCircle, AlertTriangle, Scale, Lock, ArrowLeft,
} from 'lucide-react';

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-background text-foreground py-8 px-4 sm:px-6 lg:px-8 max-w-4xl mx-auto space-y-8">
      {/* Navigation Header */}
      <div className="flex items-center justify-between border-b pb-4">
        <Link to="/" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4" /> Back to Application
        </Link>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-2xs font-mono">PWRI Internal</Badge>
          <Badge className="bg-primary/20 text-primary border-primary/30 text-2xs font-mono">v2026-10</Badge>
        </div>
      </div>

      {/* Hero Title */}
      <div className="space-y-2">
        <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-primary-soft text-primary text-xs font-medium">
          <FileText className="h-3.5 w-3.5" /> Terms of Use &amp; Operational Policy
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
          Terms of Use for PWRI Plant Monitoring Platform
        </h1>
        <p className="text-sm text-muted-foreground leading-relaxed">
          These Terms of Use govern the authorized access, operational logging, and system usage of the Pilipinas Water Resources, Inc. (&ldquo;PWRI&rdquo;) Plant Monitoring and Industrial Control Intelligence Platform.
        </p>
      </div>

      {/* Main Content Cards */}
      <div className="space-y-6 text-xs sm:text-sm text-muted-foreground leading-relaxed">
        
        {/* Section 1: Authorized Access Only */}
        <Card className="p-5 sm:p-6 space-y-3">
          <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
            <Lock className="h-4 w-4 text-primary" /> 1. Authorized Access &amp; Account Responsibility
          </h2>
          <p>
            Access to this platform is strictly restricted to active employees, plant operators, technicians, engineers, and contracted personnel authorized by PWRI.
          </p>
          <ul className="list-disc pl-5 space-y-1.5 text-xs">
            <li>Users are strictly prohibited from sharing login credentials or delegating authentication tokens.</li>
            <li>Any shift duty handover or operational override must be logged under the authenticated user&rsquo;s identity or approved operator switcher mechanism.</li>
            <li>Users must immediately report compromised credentials or lost mobile monitoring hardware to IT Operations.</li>
          </ul>
        </Card>

        {/* Section 2: Data Integrity & Legal Accountability */}
        <Card className="p-5 sm:p-6 space-y-3 border-amber-500/30 bg-amber-500/5">
          <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-amber-500" /> 2. Data Integrity &amp; True Recording Obligation
          </h2>
          <p>
            Water production volumes, chemical dosing logs, RO membrane pressures, and water quality parameters are critical to public health, environmental safety, and regulatory compliance under the Philippine Clean Water Act and PNSDW.
          </p>
          <ul className="list-disc pl-5 space-y-1.5 text-xs">
            <li><strong>Truthful Logging:</strong> All operational meter readings, sensor values, and chemical inventory adjustments must reflect actual physical observations.</li>
            <li><strong>Audit Trails:</strong> All corrections, meter replacements, and retroactive modifications create immutable audit logs in `reading_audit_logs` subject to supervisor review.</li>
            <li><strong>Falsification Prohibited:</strong> Intentional falsification of water quality parameters or flow metrics constitutes gross misconduct and is subject to disciplinary and legal action.</li>
          </ul>
        </Card>

        {/* Section 3: Acceptable Use & System Security */}
        <Card className="p-5 sm:p-6 space-y-3">
          <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
            <CheckCircle className="h-4 w-4 text-primary" /> 3. Acceptable Use &amp; Network Security
          </h2>
          <p>When utilizing the PWRI Monitoring PWA or connected APIs, users agree NOT to:</p>
          <ul className="list-disc pl-5 space-y-1.5 text-xs">
            <li>Attempt unauthorized privilege escalation or bypass Row-Level Security (RLS) constraints.</li>
            <li>Introduce automated scripts, scrapers, or DDoS tools that disrupt plant operations.</li>
            <li>Reverse engineer proprietary hydraulic calculations, dosing models, or SCADA telemetry endpoints.</li>
          </ul>
        </Card>

        {/* Section 4: Intellectual Property */}
        <Card className="p-5 sm:p-6 space-y-3">
          <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
            <Scale className="h-4 w-4 text-primary" /> 4. Intellectual Property &amp; Operational Data
          </h2>
          <p>
            All plant configuration schemas, algorithms, user interface code, chemical dosage matrices, and collected water production datasets remain the exclusive proprietary property of Pilipinas Water Resources, Inc.
          </p>
        </Card>

        {/* Section 5: Governing Law */}
        <Card className="p-5 sm:p-6 space-y-3">
          <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
            <Scale className="h-4 w-4 text-primary" /> 5. Governing Law &amp; Jurisdiction
          </h2>
          <p>
            These Terms of Use and all operational policies shall be governed by and construed in accordance with the laws of the Republic of the Philippines.
          </p>
        </Card>
      </div>

      {/* Footer Links */}
      <div className="pt-6 border-t flex flex-wrap items-center justify-between gap-4 text-xs text-muted-foreground">
        <p>&copy; {new Date().getFullYear()} Pilipinas Water Resources, Inc. (PWRI). All rights reserved.</p>
        <div className="flex items-center gap-4">
          <Link to="/terms" className="hover:text-primary transition-colors font-semibold text-foreground">Terms of Use</Link>
          <Link to="/privacy" className="hover:text-primary transition-colors">Privacy Notice</Link>
          <Link to="/help" className="hover:text-primary transition-colors">User Manual</Link>
        </div>
      </div>
    </div>
  );
}
