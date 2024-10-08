import React, { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector, connect } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { Snackbar } from '@mui/material';
import { devicesActions, sessionActions } from './store';
import { useEffectAsync } from './reactHelper';
import { useTranslation } from './common/components/LocalizationProvider';
import { snackBarDurationLongMs } from './common/util/duration';
import alarm from './resources/alarm.mp3';
import { eventsActions } from './store/events';
import useFeatures from './common/util/useFeatures';
import { useAttributePreference } from './common/util/preferences';
import { useMobileGroupPositionsMutation } from './services/mobile-group';
import { mobileGroupsActions } from './store/mobile-groups';
import { useTransportationsMutation } from './services/transportation';

const logoutCode = 4000;

const SocketController = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const t = useTranslation();
  const [getMobileGroupPostitions] = useMobileGroupPositionsMutation();
  const [getTransportations] = useTransportationsMutation();

  const authenticated = useSelector((state) => !!state.session.user);
  const axelorAuthenticated = useSelector((state) => !!state.session.axelor);
  const devices = useSelector((state) => state.devices.items);

  const socketRef = useRef();

  const [events, setEvents] = useState([]);
  const [notifications, setNotifications] = useState([]);

  const soundEvents = useAttributePreference('soundEvents', '');
  const soundAlarms = useAttributePreference('soundAlarms', 'sos');

  const features = useFeatures();

  const fetchPositions = async () => {
    const positionsResponse = await fetch('/api/positions');
    const mobilePostionGroupResponse = await getMobileGroupPostitions();
    if (Array.isArray(mobilePostionGroupResponse?.data?.data)) {
      dispatch(
        mobileGroupsActions.updatePositions(
          mobilePostionGroupResponse?.data?.data
        )
      );
    }
    if (positionsResponse.ok) {
      dispatch(sessionActions.updatePositions(await positionsResponse.json()));
    }

    return positionsResponse.status;
  };

  const fetchDevices = async () => {
    const devicesResponse = await fetch('/api/devices');
    const persistedState = localStorage.getItem('filter');
    const filterState = persistedState ? JSON.parse(persistedState) : null;
    if (devicesResponse.ok) {
      dispatch(devicesActions.update(await devicesResponse.json()));
      dispatch(devicesActions.mergeByAxelor(await getTransportations({})));
      let count = 0;
      Object.values(filterState ?? {}).map(([value]) => {
        if (!!value || value?.length < 1) {
          count++;
        }
      });

      dispatch(
        devicesActions.updateByAxelor(
          count > 0 ? await getTransportations(filterState) : null
        )
      );
    }

    return devicesResponse.status;
  };

  const connectSocket = () => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(
      `${protocol}//${window.location.host}/api/socket`
    );
    socketRef.current = socket;

    socket.onopen = () => {
      dispatch(sessionActions.updateSocket(true));
    };

    socket.onclose = async (event) => {
      dispatch(sessionActions.updateSocket(false));
      if (event.code !== logoutCode && axelorAuthenticated) {
        try {
          const devicesStatus = await fetchDevices();
          const positionsStatus = await fetchPositions();

          if (positionsStatus === 401 || devicesStatus === 401) {
            navigate('/login');
          }
        } catch (error) {
          // ignore errors
        }
        setTimeout(() => connectSocket(), 60000);
      }
    };

    socket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.devices) {
        dispatch(devicesActions.update(data.devices));
      }
      if (data.positions) {
        dispatch(sessionActions.updatePositions(data.positions));
      }
      if (data.events) {
        if (!features.disableEvents) {
          dispatch(eventsActions.add(data.events));
        }
        setEvents(data.events);
      }
    };
  };

  useEffectAsync(async () => {
    if (authenticated) {
      const response = await fetch('/api/devices');
      if (response.ok) {
        dispatch(devicesActions.refresh(await response.json()));
      } else {
        throw Error(await response.text());
      }
      connectSocket();
      return () => {
        const socket = socketRef.current;
        if (socket) {
          socket.close(logoutCode);
        }
      };
    }
    return null;
  }, [authenticated]);

  useEffect(() => {
    setNotifications(
      events.map((event) => ({
        id: event.id,
        message: event.attributes.message,
        show: true,
      }))
    );
  }, [events, devices, t]);

  useEffect(() => {
    events.forEach((event) => {
      if (
        soundEvents.includes(event.type) ||
        (event.type === 'alarm' && soundAlarms.includes(event.attributes.alarm))
      ) {
        new Audio(alarm).play();
      }
    });
  }, [events, soundEvents, soundAlarms]);

  useEffectAsync(async () => {
    if (!axelorAuthenticated) return;
    const positionsStatus = await fetchPositions();
    const devicesStatus = await fetchDevices();

    if (positionsStatus === 401 || devicesStatus === 401) {
      navigate('/login');
    }
  }, [axelorAuthenticated]);

  return (
    <>
      {notifications.map((notification) => (
        <Snackbar
          key={notification.id}
          open={notification.show}
          message={notification.message}
          autoHideDuration={snackBarDurationLongMs}
          onClose={() =>
            setEvents(events.filter((e) => e.id !== notification.id))
          }
        />
      ))}
    </>
  );
};

export default connect()(SocketController);
