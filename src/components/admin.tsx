'use client'

import React, { useEffect, useState } from 'react';
import { auth, db, storage } from '@/firebase/config';
import { collection, query, getDocs, doc, updateDoc, deleteDoc, getDoc, setDoc, orderBy, serverTimestamp } from 'firebase/firestore';
import { ref, listAll, deleteObject } from 'firebase/storage';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Users, Folder, File, Settings, Trash2, Search, Edit, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import type { Folder as FolderType, MaterialFile } from '@/types/materials';
import { useRouter } from 'next/navigation';
import { getUserFolders, updateUserFolders, getUserData } from '@/firebase/firestore';

interface User {
  uid: string;
  email: string;
  username?: string;
  role?: string;
}

interface ContactRequest {
  id: string;
  userId: string;
  userEmail: string;
  subject: string;
  message: string;
  requestType: string;
  status: string;
  createdAt: any;
}

export function AdminComponent() {
  const [users, setUsers] = useState<User[]>([]);
  const [folders, setFolders] = useState<FolderType[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [contactRequests, setContactRequests] = useState<ContactRequest[]>([]);
  const router = useRouter();

  useEffect(() => {
    const checkAdminAccess = async () => {
      const currentUser = auth.currentUser;
      if (!currentUser) {
        toast.error('Unauthorized access');
        router.push('/admin/login');
        return;
      }

      const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
      if (!userDoc.exists() || userDoc.data()?.role !== 'admin') {
        toast.error('Unauthorized access');
        router.push('/admin/login');
        return;
      }
    };

    const loadData = async () => {
      try {
        // Load users
        const usersSnapshot = await getDocs(collection(db, 'users'));
        const usersData = usersSnapshot.docs.map(doc => ({
          uid: doc.id,
          ...doc.data()
        } as User));
        setUsers(usersData);

        // Load folders from all users
        const allUserFolders: FolderType[] = [];
        for (const user of usersData) {
          const userData = await getUserData(user.uid);
          if (userData?.folders) {
            allUserFolders.push(...userData.folders);
          }
        }

        // Also load global folders
        const globalFoldersRef = doc(db, 'folders', 'global');
        const globalFoldersSnap = await getDoc(globalFoldersRef);
        const globalFolders = globalFoldersSnap.exists() ? globalFoldersSnap.data().folders || [] : [];

        // Combine all folders and set state
        setFolders([...allUserFolders, ...globalFolders]);
        console.log('Loaded folders:', [...allUserFolders, ...globalFolders]); // Debug log

        const loadContactRequests = async () => {
          const requestsQuery = query(
            collection(db, 'contactRequests'),
            orderBy('createdAt', 'desc')
          );
          const snapshot = await getDocs(requestsQuery);
          const requests = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
          } as ContactRequest));
          setContactRequests(requests);
        };

        loadContactRequests();

      } catch (error) {
        console.error('Error loading admin data:', error);
        toast.error('Failed to load data');
      } finally {
        setLoading(false);
      }
    };

    checkAdminAccess();
    loadData();
  }, [router]);

  const handleUpdateUser = async (userId: string, updates: Partial<User>) => {
    try {
      await updateDoc(doc(db, 'users', userId), updates);
      setUsers(users.map(user => 
        user.uid === userId ? { ...user, ...updates } : user
      ));
      toast.success('User updated successfully');
    } catch (error) {
      console.error('Error updating user:', error);
      toast.error('Failed to update user');
    }
  };

  const handleDeleteUser = async (userId: string) => {
    if (!confirm('Are you sure you want to delete this user? This action cannot be undone.')) {
      return;
    }

    try {
      // Delete user's folders and files
      const userFolders = folders.filter(folder => folder.createdBy === userId);
      for (const folder of userFolders) {
        const storageRef = ref(storage, `folders/${folder.id}`);
        const files = await listAll(storageRef);
        await Promise.all(files.items.map(file => deleteObject(file)));
      }

      // Delete user document
      await deleteDoc(doc(db, 'users', userId));
      setUsers(users.filter(user => user.uid !== userId));
      toast.success('User deleted successfully');
    } catch (error) {
      console.error('Error deleting user:', error);
      toast.error('Failed to delete user');
    }
  };

  const handleUpdateFolder = async (folderId: string, updates: Partial<FolderType>) => {
    try {
      const globalFoldersRef = doc(db, 'folders', 'global');
      const globalFoldersSnap = await getDoc(globalFoldersRef);
      const currentFolders = globalFoldersSnap.exists() ? globalFoldersSnap.data().folders || [] : [];
      
      const updatedFolders = currentFolders.map((folder: FolderType) =>
        folder.id === folderId ? { ...folder, ...updates } : folder
      );
      
      await setDoc(globalFoldersRef, { folders: updatedFolders }, { merge: true });

      toast.success('Folder updated successfully');
    } catch (error) {
      console.error('Error updating folder:', error);
      toast.error('Failed to update folder');
    }
  };

  const handleDeleteFolder = async (folderId: string) => {
    if (!confirm('Are you sure you want to delete this folder? This action cannot be undone.')) {
      return;
    }

    const toastId = toast.loading('Deleting folder...');

    try {
      // Find the folder to delete
      const folderToDelete = folders.find(f => f.id === folderId);
      if (!folderToDelete) {
        throw new Error('Folder not found');
      }

      // Recursively delete all files in the folder and its subfolders
      const deleteFilesRecursively = async (folder: FolderType) => {
        // Delete files in current folder
        for (const file of folder.files || []) {
          const fileRef = ref(storage, `folders/${folder.id}/${file.name}`);
          try {
            await deleteObject(fileRef);
          } catch (error) {
            console.error(`Error deleting file ${file.name}:`, error);
          }
        }

        // Recursively delete files in subfolders
        if (folder.subFolders) {
          for (const subfolder of folder.subFolders) {
            await deleteFilesRecursively(subfolder);
          }
        }
      };

      await deleteFilesRecursively(folderToDelete);

      // Update folders state by removing the deleted folder
      const updatedFolders = folders.filter(folder => folder.id !== folderId);
      setFolders(updatedFolders);

      // Update Firestore
      const globalFoldersRef = doc(db, 'folders', 'global');
      await setDoc(globalFoldersRef, { folders: updatedFolders }, { merge: true });

      toast.success('Folder deleted successfully');
    } catch (error) {
      console.error('Error deleting folder:', error);
      toast.error('Failed to delete folder. Please try again.');
    } finally {
      toast.dismiss(toastId);
    }
  };

  const handleDeleteFile = async (folderId: string, fileId: string) => {
    if (!confirm('Are you sure you want to delete this file? This action cannot be undone.')) {
      return;
    }

    const toastId = toast.loading('Deleting file...');

    try {
      // Get current global folders first
      const globalFoldersRef = doc(db, 'folders', 'global');
      const globalFoldersSnap = await getDoc(globalFoldersRef);
      const currentFolders = globalFoldersSnap.exists() ? globalFoldersSnap.data().folders || [] : [];

      // Find folder and file recursively
      const findFolderAndFile = (folders: FolderType[]): { folder: FolderType | null, file: MaterialFile | null } => {
        for (const folder of folders) {
          // Check current folder
          if (folder.id === folderId) {
            const file = folder.files?.find(f => f.id === fileId);
            if (file) {
              return { folder, file };
            }
          }
          
          // Check subfolders recursively
          if (folder.subFolders?.length) {
            const result = findFolderAndFile(folder.subFolders);
            if (result.folder && result.file) {
              return result;
            }
          }
        }
        return { folder: null, file: null };
      };

      const { folder, file } = findFolderAndFile(currentFolders);
      
      if (!folder || !file) {
        throw new Error('Folder or file not found');
      }

      try {
        // Delete file from storage using the URL instead of constructing the path
        const fileUrl = new URL(file.url);
        const storagePath = decodeURIComponent(fileUrl.pathname.split('/o/')[1].split('?')[0]);
        // Add 'global' prefix to the storage path if it's not already there
        const normalizedPath = storagePath.startsWith('global/') ? storagePath : `global/${storagePath}`;
        const fileRef = ref(storage, normalizedPath);
        await deleteObject(fileRef);
      } catch (storageError) {
        console.error('Storage deletion error:', storageError);
        // Continue with Firestore update even if storage deletion fails
      }

      // Update folders state recursively
      const updateFoldersRecursively = (folders: FolderType[]): FolderType[] => {
        return folders.map(f => {
          if (f.id === folder.id) {
            return {
              ...f,
              files: f.files.filter(file => file.id !== fileId)
            };
          }
          if (f.subFolders?.length) {
            return {
              ...f,
              subFolders: updateFoldersRecursively(f.subFolders)
            };
          }
          return f;
        });
      };

      const updatedFolders = updateFoldersRecursively(currentFolders);

      // Update Firestore
      await setDoc(globalFoldersRef, { folders: updatedFolders });
      
      // Update local state
      setFolders(updatedFolders);
      
      toast.success('File deleted successfully');
    } catch (error) {
      console.error('Error deleting file:', error);
      toast.error('Failed to delete file. Please try again.');
    } finally {
      toast.dismiss(toastId);
    }
  };

  const calculateTotalFiles = (folder: FolderType): number => {
    let total = folder.files?.length || 0;
    if (folder.subFolders) {
      folder.subFolders.forEach(subfolder => {
        total += calculateTotalFiles(subfolder);
      });
    }
    return total;
  };

  const renderFolderItem = (folder: FolderType, level = 0) => (
    <div key={folder.id}>
      <div className="flex items-center justify-between p-4 border-b" style={{ paddingLeft: `${level * 20 + 16}px` }}>
        <div>
          <p className="font-medium">{folder.name}</p>
          <p className="text-sm text-gray-500">
            {calculateTotalFiles(folder)} files • {folder.subFolders?.length || 0} subfolders • {folder.tags?.join(', ')}
          </p>
        </div>
        <div className="flex space-x-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleUpdateFolder(folder.id, {
              name: folder.name,
              tags: folder.tags
            })}
          >
            <Edit className="h-4 w-4 mr-2" />
            Edit
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => handleDeleteFolder(folder.id)}
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Delete
          </Button>
        </div>
      </div>
      {/* Render files */}
      {folder.files && folder.files.length > 0 && (
        <div className="ml-8">
          {folder.files.map(file => (
            <div key={file.id} className="flex items-center justify-between p-2 border-b">
              <div className="flex items-center">
                <File className="h-4 w-4 mr-2 text-gray-500" />
                <span>{file.name}</span>
              </div>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => handleDeleteFile(folder.id, file.id)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
      {/* Render subfolders recursively */}
      {folder.subFolders?.map(subfolder => renderFolderItem(subfolder, level + 1))}
    </div>
  );

  const handleContactRequest = async (requestId: string, status: 'approved' | 'rejected') => {
    try {
      await updateDoc(doc(db, 'contactRequests', requestId), {
        status,
        updatedAt: serverTimestamp(),
      });
      
      setContactRequests(requests =>
        requests.map(request =>
          request.id === requestId ? { ...request, status } : request
        )
      );
      
      toast.success(`Request ${status} successfully`);
    } catch (error) {
      console.error('Error updating request:', error);
      toast.error('Failed to update request');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-lg">Loading admin panel...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#E6F3F5] p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-[#1A5F7A]">Admin Dashboard</h1>
      </header>

      <Tabs defaultValue="users">
        <TabsList>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="folders">Folders</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
          <TabsTrigger value="requests">Contact Requests</TabsTrigger>
        </TabsList>

        <TabsContent value="users">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>User Management</span>
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-[#57A7B3]" />
                  <Input
                    type="text"
                    placeholder="Search users..."
                    className="pl-8"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[500px]">
                {users
                  .filter(user => 
                    user.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                    user.username?.toLowerCase().includes(searchQuery.toLowerCase())
                  )
                  .map(user => (
                    <div key={user.uid} className="flex items-center justify-between p-4 border-b">
                      <div>
                        <p className="font-medium">{user.username || user.email}</p>
                        <p className="text-sm text-gray-500">{user.role || 'user'}</p>
                      </div>
                      <div className="flex space-x-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setSelectedUser(user)}
                        >
                          <Edit className="h-4 w-4 mr-2" />
                          Edit
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleDeleteUser(user.uid)}
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Delete
                        </Button>
                      </div>
                    </div>
                  ))}
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="folders">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Global Folders Management</span>
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-[#57A7B3]" />
                  <Input
                    type="text"
                    placeholder="Search folders..."
                    className="pl-8"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent>
            <ScrollArea className="h-[500px]">
  {folders
    .filter(folder => 
      folder.name.toLowerCase().includes(searchQuery.toLowerCase())
    )
    .map(folder => renderFolderItem(folder))}
  {folders.length === 0 && (
    <div className="text-center py-8 text-gray-500">
      No folders found
    </div>
  )}
</ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="settings">
          <Card>
            <CardHeader>
              <CardTitle>System Settings</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <h3 className="text-lg font-medium mb-2">Storage Settings</h3>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between p-2 bg-gray-50 rounded">
                      <span>Maximum file size</span>
                      <span className="font-medium">10 MB</span>
                    </div>
                    <div className="flex items-center justify-between p-2 bg-gray-50 rounded">
                      <span>Allowed file types</span>
                      <span className="font-medium">Documents, Images, Text</span>
                    </div>
                  </div>
                </div>
                
                <div>
                  <h3 className="text-lg font-medium mb-2">User Settings</h3>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between p-2 bg-gray-50 rounded">
                      <span>Total users</span>
                      <span className="font-medium">{users.length}</span>
                    </div>
                    <div className="flex items-center justify-between p-2 bg-gray-50 rounded">
                      <span>Admin users</span>
                      <span className="font-medium">
                        {users.filter(user => user.role === 'admin').length}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="requests">
          <Card>
            <CardHeader>
              <CardTitle>Contact Requests</CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[500px]">
                {contactRequests.map((request) => (
                  <div key={request.id} className="border-b p-4">
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <h3 className="font-medium">{request.subject}</h3>
                        <p className="text-sm text-gray-500">
                          From: {request.userEmail} • Type: {request.requestType}
                        </p>
                      </div>
                      <span className={`px-2 py-1 rounded text-sm ${
                        request.status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                        request.status === 'approved' ? 'bg-green-100 text-green-800' :
                        'bg-red-100 text-red-800'
                      }`}>
                        {request.status}
                      </span>
                    </div>
                    <p className="text-sm mb-4">{request.message}</p>
                    {request.status === 'pending' && (
                      <div className="flex space-x-2">
                        <Button
                          size="sm"
                          onClick={() => handleContactRequest(request.id, 'approved')}
                          className="bg-green-500 hover:bg-green-600"
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => handleContactRequest(request.id, 'rejected')}
                        >
                          Reject
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Edit User Dialog */}
      <Dialog open={!!selectedUser} onOpenChange={() => setSelectedUser(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Username</Label>
              <Input
                value={selectedUser?.username || ''}
                onChange={(e) => setSelectedUser(prev => 
                  prev ? { ...prev, username: e.target.value } : null
                )}
              />
            </div>
            <div>
              <Label>Role</Label>
              <select
                className="w-full p-2 border rounded"
                value={selectedUser?.role || 'user'}
                onChange={(e) => setSelectedUser(prev =>
                  prev ? { ...prev, role: e.target.value } : null
                )}
              >
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <Button
              onClick={() => {
                if (selectedUser) {
                  handleUpdateUser(selectedUser.uid, {
                    username: selectedUser.username,
                    role: selectedUser.role
                  });
                  setSelectedUser(null);
                }
              }}
            >
              Save Changes
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
} 