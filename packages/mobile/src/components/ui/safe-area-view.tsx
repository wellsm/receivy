import { SafeAreaView as ContextSafeAreaView } from "react-native-safe-area-context";
import { withUniwind } from "uniwind";

/**
 * Uniwind only resolves `className` on `react-native` core components. The
 * safe-area-context SafeAreaView is third-party, so without this wrapper its
 * `className="flex-1 …"` is silently dropped on native, the container gets no
 * flex and every `flex-1` child collapses to zero height (blank screens on the
 * first iOS development build). Always import SafeAreaView from here.
 */
export const SafeAreaView = withUniwind(ContextSafeAreaView);
