interface SlackHelpProps {
    onBack: () => void;
}

export default function SlackHelp({ onBack }: SlackHelpProps) {
    return (
        <div className="flex flex-col gap-5">
            <div
                className="flex items-center justify-between gap-3 pb-3 border-b"
                style={{ borderColor: 'var(--border-subtle)' }}
            >
                <div className="flex items-center gap-3">
                    <button
                        type="button"
                        onClick={onBack}
                        className="kai-btn kai-btn-secondary kai-btn-sm"
                    >
                        <span className="material-symbols-outlined text-base">arrow_back</span>
                        Back
                    </button>
                    <div>
                        <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                            Slack Socket Mode Setup
                        </h3>
                        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                            Connect your Slack workspace without exposing a public inbound webhook
                        </p>
                    </div>
                </div>
            </div>

            <div className="flex flex-col gap-4 text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                <section className="kai-surface-subtle flex flex-col gap-2">
                    <h4 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--accent-primary)' }}>
                        1. Create a Slack App
                    </h4>
                    <p>
                        Open{' '}
                        <a
                            href="https://api.slack.com/apps"
                            target="_blank"
                            rel="noreferrer"
                            className="underline underline-offset-2 font-medium"
                            style={{ color: 'var(--accent-primary)' }}
                        >
                            api.slack.com/apps
                        </a>{' '}
                        and select <strong>Create New App</strong> &rarr; <strong>From scratch</strong>.
                    </p>
                </section>

                <section className="kai-surface-subtle flex flex-col gap-2">
                    <h4 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--accent-primary)' }}>
                        2. Enable Socket Mode &amp; App Token
                    </h4>
                    <p>
                        Open <strong>Socket Mode</strong> in the app sidebar and enable it. Generate an{' '}
                        <strong>App-Level Token</strong> with the <code className="kai-mono">connections:write</code> scope.
                    </p>
                    <div
                        className="kai-mono text-xs p-2.5 rounded border"
                        style={{
                            backgroundColor: 'var(--bg-primary)',
                            borderColor: 'var(--border-subtle)',
                            color: 'var(--text-primary)',
                        }}
                    >
                        Copy the token starting with <strong>xapp-</strong> into the <strong>Slack App Token</strong> field.
                    </div>
                </section>

                <section className="kai-surface-subtle flex flex-col gap-2">
                    <h4 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--accent-primary)' }}>
                        3. Configure Bot Token Scopes
                    </h4>
                    <p>
                        Under <strong>OAuth &amp; Permissions</strong> &rarr; <strong>Bot Token Scopes</strong>, add:
                    </p>
                    <ul className="list-disc pl-5 space-y-1 kai-mono text-xs" style={{ color: 'var(--text-primary)' }}>
                        <li>app_mentions:read</li>
                        <li>chat:write</li>
                        <li>im:history</li>
                    </ul>
                    <p>
                        Click <strong>Install to Workspace</strong> to generate your Bot User OAuth Token.
                    </p>
                    <div
                        className="kai-mono text-xs p-2.5 rounded border"
                        style={{
                            backgroundColor: 'var(--bg-primary)',
                            borderColor: 'var(--border-subtle)',
                            color: 'var(--text-primary)',
                        }}
                    >
                        Copy the token starting with <strong>xoxb-</strong> into the <strong>Slack Bot Token</strong> field.
                    </div>
                </section>

                <section className="kai-surface-subtle flex flex-col gap-2">
                    <h4 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--accent-primary)' }}>
                        4. Subscribe to Events
                    </h4>
                    <p>
                        Under <strong>Event Subscriptions</strong>, enable events and subscribe to{' '}
                        <code className="kai-mono">app_mention</code> and <code className="kai-mono">message.im</code> under{' '}
                        <strong>Subscribe to bot events</strong>.
                    </p>
                </section>

                <div className="kai-alert kai-alert-info flex items-start gap-2.5">
                    <span className="material-symbols-outlined text-base shrink-0 mt-0.5">info</span>
                    <div className="text-xs">
                        Save your settings after pasting both tokens. Socket Mode connects automatically in the background; check
                        System Logs &rarr; Comms if you need to inspect connection diagnostics.
                    </div>
                </div>
            </div>
        </div>
    );
}
