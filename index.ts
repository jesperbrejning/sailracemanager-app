/**
 * Entry point for the SailRaceManager app.
 * 
 * IMPORTANT: The background tracking import MUST come before
 * registerRootComponent to ensure the TaskManager task is
 * registered before any component renders.
 */

// Register background GPS tracking task first
import './src/services/backgroundTracking';

import { registerRootComponent } from 'expo';
import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
