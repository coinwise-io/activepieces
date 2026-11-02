import { t } from 'i18next';
import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { authenticationApi } from '@/api/authentication-api';
import { LoadingScreen } from '@/components/custom/loading-screen';
import { authenticationSession } from '@/lib/authentication-session';
import { federatedLoginRedirect } from '@/lib/federated-login-redirect';

const AuthenticatePage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const hasClaimed = useRef(false);

  useEffect(() => {
    if (hasClaimed.current) {
      return;
    }
    hasClaimed.current = true;
    const code = new URLSearchParams(location.search).get('code');
    if (!code) {
      navigate('/sign-in');
      return;
    }
    authenticationApi
      .claimSamlLogin({ code })
      .then((data) => {
        authenticationSession.saveResponse(data, false);
        navigate(federatedLoginRedirect.consume() ?? '/flows');
      })
      .catch(() => {
        toast(t('Sign-in failed'));
        navigate('/sign-in');
      });
  }, [location.search]);

  return <LoadingScreen />;
};

export default AuthenticatePage;
