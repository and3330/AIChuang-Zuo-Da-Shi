import { useLocation, Link } from "wouter";
import { useUser } from "@/App";

export default function MobileTabBar() {
  const { user } = useUser();
  const [location] = useLocation();

  if (!user) return null;

  const tabs = [
    { label: "首頁", icon: "fa-home", route: "/" },
    { label: "漫劇", icon: "fa-film", route: "/drama" },
    { label: "套圖", icon: "fa-images", route: "/photoset" },
    { label: "角色庫", icon: "fa-user-friends", route: "/character-library" },
    { label: "帳戶", icon: "fa-user", route: "/account" },
    ...(user.isAdmin ? [{ label: "管理", icon: "fa-cog", route: "/admin" }] : []),
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-200 sm:hidden pb-[env(safe-area-inset-bottom)]">
      <div className="flex items-center justify-around h-[60px]">
        {tabs.map((tab) => {
          const isActive = location === tab.route;
          return (
            <Link key={tab.route} href={tab.route} className="flex-1">
              <div className="flex flex-col items-center justify-center gap-0.5 py-1">
                <i
                  className={`fas ${tab.icon} text-lg ${
                    isActive ? "text-purple-600" : "text-gray-400"
                  }`}
                />
                <span
                  className={`text-[10px] font-medium ${
                    isActive ? "text-purple-600" : "text-gray-400"
                  }`}
                >
                  {tab.label}
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
