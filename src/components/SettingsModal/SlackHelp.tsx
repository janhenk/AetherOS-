
interface SlackHelpProps {
    onBack: () => void;
}

export default function SlackHelp({ onBack }: SlackHelpProps) {
    return (
        <div style={{ padding: 20, color: 'var(--lcars-text)', fontFamily: 'var(--font-mono)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
                <button 
                    onClick={onBack}
                    style={{
                        background: 'var(--lcars-warning)',
                        border: 'none',
                        borderRadius: '4px 0 0 4px',
                        padding: '4px 12px',
                        cursor: 'pointer',
                        fontFamily: 'var(--font-display)',
                        fontWeight: 700,
                        fontSize: 12,
                        color: '#000'
                    }}
                >
                    BACK
                </button>
                <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', color: 'var(--lcars-warning)', fontSize: 18 }}>
                    SLACK INTEGRATION GUIDE
                </h2>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 24, fontSize: 13, lineHeight: '1.5' }}>
                <section>
                    <h3 style={{ color: 'var(--lcars-sage)', borderBottom: '1px solid #333', paddingBottom: 4, marginBottom: 12 }}>
                        STEP 1: CREATE SLACK APP
                    </h3>
                    <p>Go to <a href="https://api.slack.com/apps" target="_blank" rel="noreferrer" style={{ color: 'var(--lcars-warning)' }}>api.slack.com/apps</a> and click <strong>"Create New App"</strong>. Select <strong>"From scratch"</strong>.</p>
                </section>

                <section>
                    <h3 style={{ color: 'var(--lcars-sage)', borderBottom: '1px solid #333', paddingBottom: 4, marginBottom: 12 }}>
                        STEP 2: ENABLE SOCKET MODE
                    </h3>
                    <p>In the App settings menu, go to <strong>"Socket Mode"</strong> and toggle it <strong>ON</strong>.</p>
                    <p>You will be prompted to generate an <strong>App-Level Token</strong>. Give it a name (e.g. <code>AetherOS-Socket</code>) and add the <code>connections:write</code> scope.</p>
                    <div style={{ background: '#111', padding: 8, border: '1px solid #222', borderRadius: 4, marginTop: 8 }}>
                        <strong>COPY TOKEN:</strong> Starts with <code>xapp-...</code> (Paste this into <strong>App Token</strong> field)
                    </div>
                </section>

                <section>
                    <h3 style={{ color: 'var(--lcars-sage)', borderBottom: '1px solid #333', paddingBottom: 4, marginBottom: 12 }}>
                        STEP 3: CONFIGURE SCOPES & BOT
                    </h3>
                    <p>Go to <strong>"OAuth & Permissions"</strong>. Under <strong>"Scopes"</strong> {'>'} <strong>"Bot Token Scopes"</strong>, add:</p>
                    <ul style={{ margin: '8px 0', paddingLeft: 20 }}>
                        <li><code>app_mentions:read</code></li>
                        <li><code>chat:write</code></li>
                        <li><code>im:history</code> (to respond in DMs)</li>
                    </ul>
                    <p>Now, click <strong>"Install to Workspace"</strong> at the top of the page.</p>
                    <div style={{ background: '#111', padding: 8, border: '1px solid #222', borderRadius: 4, marginTop: 8 }}>
                        <strong>COPY TOKEN:</strong> Starts with <code>xoxb-...</code> (Paste this into <strong>Bot Token</strong> field)
                    </div>
                </section>

                <section>
                    <h3 style={{ color: 'var(--lcars-sage)', borderBottom: '1px solid #333', paddingBottom: 4, marginBottom: 12 }}>
                        STEP 4: EVENTS (OPTIONAL BUT RECOMMENDED)
                    </h3>
                    <p>Go to <strong>"Event Subscriptions"</strong> and toggle it <strong>ON</strong>. Ensure the bot is subscribed to <code>app_mention</code> and <code>message.im</code> under "Bot Events".</p>
                </section>

                <div style={{ padding: 12, background: 'rgba(255,165,0,0.1)', border: '1px solid var(--lcars-warning)', borderRadius: 4, color: 'var(--lcars-warning)', fontSize: 11 }}>
                    <span className="material-symbols-outlined" style={{ verticalAlign: 'middle', marginRight: 8, fontSize: 16 }}>warning</span>
                    <strong>IMPORTANT:</strong> Re-save settings after pasting tokens. Socket Mode connects automatically on the background. Check server logs for status.
                </div>
            </div>
        </div>
    );
}
