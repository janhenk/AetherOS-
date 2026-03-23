import React, { useState, useEffect } from 'react';
import { apiFetch } from '../../utils/api';
import { getAllAgents } from '../../agents';
import { useAppContext } from '../../context/AppContext';

interface CronJob {
  id: string;
  name: string;
  schedule: string;
  agentId: string;
  prompt: string;
  enabled: boolean;
}

export default function CronManager() {
  const { state } = useAppContext();
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [isEditing, setIsEditing] = useState(false);
  const [currentJob, setCurrentJob] = useState<Partial<CronJob>>({
    name: '',
    schedule: '0 8 * * *',
    agentId: 'nav',
    prompt: '',
    enabled: true
  });
  const [error, setError] = useState<string | null>(null);

  const agents = getAllAgents(state.settings.agentOverrides);

  useEffect(() => {
    fetchJobs();
  }, []);

  const fetchJobs = async () => {
    try {
      const res = await apiFetch('/api/cron/jobs');
      if (res.ok) {
        setJobs(await res.json());
      }
    } catch (err) {
      console.error('Failed to fetch cron jobs:', err);
    }
  };

  const handleSave = async () => {
    if (!currentJob.name || !currentJob.schedule || !currentJob.prompt) {
      setError('All fields except ID are required.');
      return;
    }
    try {
      const res = await apiFetch('/api/cron/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(currentJob)
      });
      if (res.ok) {
        fetchJobs();
        setIsEditing(false);
        setCurrentJob({ name: '', schedule: '0 8 * * *', agentId: 'nav', prompt: '', enabled: true });
        setError(null);
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to save job');
      }
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this scheduled task?')) return;
    try {
      const res = await apiFetch(`/api/cron/jobs/${id}`, { method: 'DELETE' });
      if (res.ok) fetchJobs();
    } catch (err) {
      console.error('Failed to delete job:', err);
    }
  };

  const handleToggle = async (id: string) => {
    try {
      const res = await apiFetch(`/api/cron/jobs/${id}/toggle`, { method: 'POST' });
      if (res.ok) fetchJobs();
    } catch (err) {
      console.error('Failed to toggle job:', err);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={headerStyle}>SCHEDULED PROTOCOLS</h3>
        {!isEditing && (
          <button 
            onClick={() => setIsEditing(true)}
            style={{ ...btnStyle, background: 'var(--lcars-sage)', color: '#141414' }}
          >
            ADD TASK ◈
          </button>
        )}
      </div>

      {isEditing && (
        <div style={formStyle}>
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={labelStyle}>TASK NAME</div>
              <input 
                type="text" 
                value={currentJob.name} 
                onChange={e => setCurrentJob({ ...currentJob, name: e.target.value })}
                placeholder="e.g. Daily Diagnostic"
                style={inputStyle}
              />
            </div>
            <div style={{ flex: 1 }}>
              <div style={labelStyle}>CRON EXPRESSION</div>
              <input 
                type="text" 
                value={currentJob.schedule} 
                onChange={e => setCurrentJob({ ...currentJob, schedule: e.target.value })}
                placeholder="* * * * *"
                style={inputStyle}
              />
            </div>
          </div>
          
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={labelStyle}>AGENT</div>
              <select 
                value={currentJob.agentId} 
                onChange={e => setCurrentJob({ ...currentJob, agentId: e.target.value })}
                style={inputStyle}
              >
                {agents.map(a => (
                  <option key={a.id} value={a.id}>{a.shortName} ({a.name})</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <div style={labelStyle}>AGENT PROMPT</div>
            <textarea 
              value={currentJob.prompt} 
              onChange={e => setCurrentJob({ ...currentJob, prompt: e.target.value })}
              placeholder="What should the agent do when triggered?"
              style={{ ...inputStyle, height: 80, resize: 'vertical' }}
            />
          </div>

          {error && <div style={{ color: 'var(--lcars-warning)', fontSize: 11, fontWeight: 700 }}>{error}</div>}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={() => setIsEditing(false)} style={btnStyle}>CANCEL</button>
            <button onClick={handleSave} style={{ ...btnStyle, background: 'var(--lcars-sage)', color: '#141414' }}>SAVE PROTOCOL</button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {jobs.length === 0 && !isEditing && (
          <div style={{ padding: 20, textAlign: 'center', color: '#444', border: '1px dashed #2a2a2a', borderRadius: 8 }}>
            NO SCHEDULED PROTOCOLS FOUND
          </div>
        )}
        {jobs.map(job => (
          <div key={job.id} style={{
            background: 'rgba(255,255,255,0.03)',
            border: `1px solid ${job.enabled ? '#2a2a2a' : '#1a1a1a'}`,
            borderRadius: 8,
            padding: '12px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            opacity: job.enabled ? 1 : 0.6
          }}>
            <div style={{
              width: 40, height: 40, borderRadius: '50%', 
              background: agents.find(a => a.id === job.agentId)?.color || '#444',
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#141414'
            }}>
              <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
                {agents.find(a => a.id === job.agentId)?.icon || 'smart_toy'}
              </span>
            </div>
            
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 13, letterSpacing: '0.05em' }}>{job.name}</span>
                <span style={{ fontSize: 10, color: 'var(--lcars-sage)', fontFamily: 'var(--font-mono)' }}>[{job.schedule}]</span>
              </div>
              <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>
                {agents.find(a => a.id === job.agentId)?.shortName} ◈ "{job.prompt.substring(0, 60)}{job.prompt.length > 60 ? '...' : ''}"
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button 
                onClick={() => handleToggle(job.id)}
                style={{
                  ...iconBtnStyle,
                  color: job.enabled ? 'var(--lcars-sage)' : '#444'
                }}
              >
                <span className="material-symbols-outlined">{job.enabled ? 'check_circle' : 'do_not_disturb_on'}</span>
              </button>
              <button 
                onClick={() => {
                  setCurrentJob(job);
                  setIsEditing(true);
                }}
                style={iconBtnStyle}
              >
                <span className="material-symbols-outlined">edit</span>
              </button>
              <button 
                onClick={() => handleDelete(job.id)}
                style={{ ...iconBtnStyle, color: '#ff6666' }}
              >
                <span className="material-symbols-outlined">delete</span>
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const headerStyle: React.CSSProperties = {
  fontFamily: 'var(--font-display)',
  fontSize: 12,
  letterSpacing: '0.15em',
  color: 'var(--lcars-sage)',
  margin: 0
};

const labelStyle: React.CSSProperties = {
  fontSize: 9,
  color: '#444',
  marginBottom: 4,
  fontFamily: 'var(--font-display)',
  letterSpacing: '0.1em'
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: '#050505',
  border: '1px solid #2a2a2a',
  borderLeft: '2px solid var(--lcars-sage)',
  color: 'var(--lcars-text)',
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  padding: '8px 12px',
  borderRadius: 4,
  outline: 'none',
};

const btnStyle: React.CSSProperties = {
  fontFamily: 'var(--font-display)',
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.05em',
  padding: '6px 14px',
  borderRadius: 'var(--radius-pill)',
  border: '1px solid #333',
  background: 'transparent',
  color: 'var(--lcars-text-dim)',
  cursor: 'pointer'
};

const iconBtnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#666',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 4,
  transition: 'all 0.2s'
};

const formStyle: React.CSSProperties = {
  padding: 16,
  border: '1px solid #1a1a1a',
  borderRadius: 8,
  background: 'rgba(255,255,255,0.02)',
  display: 'flex',
  flexDirection: 'column',
  gap: 12
};
