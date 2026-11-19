import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@testing-library/jest-dom';
import ConvoOptions from '../ConvoOptions';

const mockUseHasAccess = jest.fn();

jest.mock('@ariakit/react', () => ({
  MenuButton: jest
    .requireActual('react')
    .forwardRef(
      (
        { children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>,
        ref: React.ForwardedRef<HTMLButtonElement>,
      ) => (
        <button ref={ref} {...props}>
          {children}
        </button>
      ),
    ),
}));
jest.mock('~/utils', () => ({
  cn: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' '),
  rowActionClasses: () => 'row-action',
}));
jest.mock('librechat-data-provider', () => ({
  QueryKeys: { messages: 'messages' },
  PermissionTypes: { SHARED_LINKS: 'shared_links', CONVERSATIONS: 'conversations' },
  Permissions: { CREATE: 'create', DELETE: 'delete' },
}));
jest.mock('@librechat/client', () => ({
  DropdownPopup: ({
    trigger,
    items,
  }: {
    trigger: React.ReactNode;
    items: Array<{ label: string; show?: boolean }>;
  }) => (
    <>
      {trigger}
      {items
        .filter((item) => item.show !== false)
        .map((item) => (
          <button key={item.label} type="button">
            {item.label}
          </button>
        ))}
    </>
  ),
  Spinner: () => <span role="status" />,
  buttonVariants: () => '',
  useToastContext: () => ({ showToast: jest.fn() }),
  useMediaQuery: () => false,
  useRemScale: () => 1,
}));

jest.mock('~/data-provider', () => ({
  useDuplicateConversationMutation: () => ({ mutate: jest.fn(), isLoading: false }),
  useAssignConversationToProjectMutation: () => ({ mutate: jest.fn(), isLoading: false }),
  useDeleteConversationMutation: () => ({ mutate: jest.fn(), isLoading: false }),
  useGetStartupConfig: () => ({ data: { sharedLinksEnabled: false } }),
  useArchiveConvoMutation: () => ({ mutate: jest.fn(), isLoading: false }),
  usePinConversationMutation: () => ({ mutate: jest.fn(), isLoading: false }),
  useMarkConversationUnreadMutation: () => ({ mutate: jest.fn(), isLoading: false }),
}));

jest.mock('~/hooks', () => ({
  useHasAccess: (args: unknown) => mockUseHasAccess(args),
  useLocalize: () => (key: string) => key,
  useNavigateToConvo: () => ({ navigateToConvo: jest.fn() }),
  useNewConvo: () => ({ newConversation: jest.fn() }),
}));

jest.mock('~/Providers', () => ({
  useChatContext: () => ({
    index: 0,
    conversation: { conversationId: 'conversation-1' },
    setConversation: jest.fn(),
  }),
  useLiveAnnouncer: () => ({ announcePolite: jest.fn() }),
}));

jest.mock('../DeleteButton', () => () => null);
jest.mock('../ShareButton', () => () => null);

const renderOptions = (props: Partial<React.ComponentProps<typeof ConvoOptions>>) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/c/conversation-1']}>
        <Routes>
          <Route
            path="/c/:conversationId"
            element={
              <ConvoOptions
                conversationId="conversation-1"
                title="A conversation"
                retainView={jest.fn()}
                renameHandler={jest.fn()}
                isPopoverActive={true}
                setIsPopoverActive={jest.fn()}
                isActiveConvo={false}
                {...props}
              />
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

const grantDelete = (granted: boolean) => mockUseHasAccess.mockReturnValue(granted);

describe('ConvoOptions delete permission', () => {
  beforeEach(() => {
    mockUseHasAccess.mockReset();
  });

  it('asks for the conversations delete permission', () => {
    grantDelete(true);
    renderOptions({});

    expect(mockUseHasAccess).toHaveBeenCalledWith({
      permissionType: 'conversations',
      permission: 'delete',
    });
  });

  describe('overflow menu', () => {
    it('lists delete when the role holds the permission', () => {
      grantDelete(true);
      renderOptions({});

      expect(screen.getByRole('button', { name: 'com_ui_delete' })).toBeInTheDocument();
    });

    it('hides delete, and only delete, when the role lacks the permission', () => {
      grantDelete(false);
      renderOptions({});

      expect(screen.queryByRole('button', { name: 'com_ui_delete' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'com_ui_archive' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'com_ui_rename' })).toBeInTheDocument();
    });
  });

  /** Holding shift on the open conversation swaps the menu for one-click archive and delete
   *  buttons, a second way to reach delete that the permission has to close as well. */
  describe('shift-held quick actions', () => {
    const quickActions = { isShiftHeld: true, isActiveConvo: true, isPopoverActive: false };

    it('offers the one-click delete when the role holds the permission', () => {
      grantDelete(true);
      renderOptions(quickActions);

      expect(screen.getByRole('button', { name: 'com_ui_delete' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'com_ui_archive' })).toBeInTheDocument();
    });

    it('drops the one-click delete, keeping archive, when the role lacks the permission', () => {
      grantDelete(false);
      renderOptions(quickActions);

      expect(screen.queryByRole('button', { name: 'com_ui_delete' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'com_ui_archive' })).toBeInTheDocument();
    });
  });
});
