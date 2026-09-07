import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import Avatar from '../components/Avatar';
import { showToast } from '../utils/toast';
import { useI18n } from '../contexts/I18nContext';
import './JoinGroup.css';

export default function JoinGroup() {
  const { token = '' } = useParams();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [joining, setJoining] = useState(true);

  useEffect(() => {
    let alive = true;
    const safeToken = encodeURIComponent(token);
    const join = async () => {
      try {
        const { data: group } = await axios.get(`/api/messages/join/${safeToken}/preview`);
        if (!alive) return;
        setPreview(group);
        const { data } = await axios.post(`/api/messages/join/${safeToken}`);
        if (!alive) return;
        const conversation = data?.conversation || {
          id: data?.conversationId || group.conversationId,
          type: 'group', name: group.name, avatar: group.avatar,
        };
        showToast(data?.alreadyMember ? t('join.alreadyMember') : t('join.success'), 'success');
        navigate('/', { replace: true, state: { openConversation: conversation } });
      } catch (requestError) {
        if (alive) setError(requestError.response?.data?.error || t('join.failed'));
      } finally {
        if (alive) setJoining(false);
      }
    };
    join();
    return () => { alive = false; };
  }, [token, navigate, t]);

  return (
    <div className="join-page">
      <section className="join-card" aria-busy={joining}>
        <Avatar src={preview?.avatar} name={preview?.name || t('common.appName')} size='xl' />
        <h1>{preview?.name || t('join.title')}</h1>
        {preview?.memberCount != null && <p>{t('join.memberCountTemplate').replace('{count}', preview.memberCount)}</p>}
        {joining ? (
          <div className="join-status" role="status">{t('join.joining')}</div>
        ) : error ? (
          <>
            <div className="join-error" role="alert">{error}</div>
            <button type="button" onClick={() => navigate('/', { replace: true })}>{t('join.backHome')}</button>
          </>
        ) : null}
      </section>
    </div>
  );
}
