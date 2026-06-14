/**
 * Hint Mobile - List Detail Screen
 * FIXED: Better modal spacing, button alignment, removed extra whitespace
 */

import React, { useState, useCallback } from 'react';
import { View, StyleSheet, FlatList, RefreshControl, Linking, Alert, Image, Share, Clipboard } from 'react-native';
import { Text, IconButton, Portal, Modal, Button, Surface, FAB, Menu } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import type { ListsScreenProps } from '../../navigation/types';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { productService, claimService, listService } from '../../../shared/services';
import type { Product, List } from '../../../shared/types';
import ProductCard from '../../components/ProductCard';
import LoadingSkeleton from '../../components/LoadingSkeleton';
import EmptyState from '../../components/EmptyState';
import PriceHistoryChart from '../../components/PriceHistoryChart';
import { colors } from '../../theme/colors';

export default function ListDetailScreen({ route, navigation }: ListsScreenProps<'ListDetail'>) {
  const { listId, listName } = route.params;
  const { theme } = useTheme();
  const { user } = useAuth();

  const [products, setProducts] = useState<Product[]>([]);
  const [listData, setListData] = useState<List | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [productModalVisible, setProductModalVisible] = useState(false);
  const [shareModalVisible, setShareModalVisible] = useState(false);
  const [addMenuVisible, setAddMenuVisible] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);

  const loadProducts = async (showRefresh = false) => {
    if (showRefresh) setIsRefreshing(true);
    else setIsLoading(true);

    try {
      const [productsResult, listResult] = await Promise.all([
        productService.getProductsByListId(listId),
        listService.getList(listId),
      ]);
      if (productsResult.data) {
        setProducts(productsResult.data);
      }
      if (listResult.data) {
        setListData(listResult.data);
      }
    } catch (error) {
      console.error('Failed to load products:', error);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      loadProducts();
    }, [listId])
  );

  // Use provided listName or fall back to loaded list data
  const displayName = listName || listData?.name || 'List';

  React.useLayoutEffect(() => {
    navigation.setOptions({
      title: displayName,
      headerRight: () => (
        <View style={styles.headerButtons}>
          <IconButton
            icon="share-variant"
            size={22}
            onPress={() => setShareModalVisible(true)}
          />
          <IconButton
            icon="pencil"
            size={22}
            onPress={() => navigation.navigate('EditList', { listId })}
          />
        </View>
      ),
    });
  }, [navigation, displayName, listId]);

  const handleRefresh = () => loadProducts(true);

  const handleProductPress = (product: Product) => {
    setSelectedProduct(product);
    setProductModalVisible(true);
  };

  const handleOpenUrl = async () => {
    if (selectedProduct?.url) {
      await Linking.openURL(selectedProduct.url);
      setProductModalVisible(false);
    }
  };

  const handleClaimProduct = async () => {
    if (!selectedProduct) return;

    // Check if already claimed
    if (selectedProduct.claimed_by || selectedProduct.guest_claimer_name) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      Alert.alert('Already Claimed', 'This item has already been claimed by someone.');
      return;
    }

    setIsClaiming(true);
    try {
      const result = await claimService.claimProduct(selectedProduct.id);
      if (result.error) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        Alert.alert('Error', result.error.message);
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert('Success', 'You have claimed this item!', [
          {
            text: 'OK',
            onPress: () => {
              setProductModalVisible(false);
              loadProducts(true);
            },
          },
        ]);
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to claim item. Please try again.');
    } finally {
      setIsClaiming(false);
    }
  };

  const handleShareList = async () => {
    const shareCode = listData?.share_code || listData?.access_code;
    const shareUrl = `https://hint.com/list/${shareCode}`;

    try {
      await Share.share({
        message: `Check out my wishlist "${displayName}" on Hint!\n${shareUrl}`,
        url: shareUrl,
      });
    } catch (error) {
      // User cancelled
    }
  };

  const handleCopyShareCode = () => {
    const shareCode = listData?.share_code || listData?.access_code;
    if (shareCode) {
      Clipboard.setString(shareCode);
      Alert.alert('Copied!', 'Share code copied to clipboard');
    }
  };

  const handleCopyShareLink = () => {
    const shareCode = listData?.share_code || listData?.access_code;
    const shareUrl = `https://hint.com/list/${shareCode}`;
    Clipboard.setString(shareUrl);
    Alert.alert('Copied!', 'Share link copied to clipboard');
  };

  const renderProduct = ({ item }: { item: Product }) => (
    <ProductCard
      product={item}
      onPress={() => handleProductPress(item)}
    />
  );

  // Check if product is claimed
  const isProductClaimed = selectedProduct?.claimed_by || selectedProduct?.guest_claimer_name;

  if (isLoading && !isRefreshing) {
    return (
      <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
        <LoadingSkeleton count={3} type="product" />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {products.length === 0 ? (
        <EmptyState
          icon="gift"
          title="No items yet"
          description="Add products to this list using the share button in your browser"
        />
      ) : (
        <FlatList
          data={products}
          renderItem={renderProduct}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              tintColor={theme.colors.primary}
            />
          }
        />
      )}

      {/* Product Detail Modal */}
      <Portal>
        <Modal
          visible={productModalVisible}
          onDismiss={() => setProductModalVisible(false)}
          contentContainerStyle={[styles.modalContainer, { backgroundColor: theme.colors.surface }]}
        >
          {selectedProduct && (
            <View style={styles.modalContent}>
              {/* Product Image */}
              {selectedProduct.image_url && (
                <View style={styles.modalImageContainer}>
                  <Image
                    source={{ uri: selectedProduct.image_url }}
                    style={styles.modalImage}
                    resizeMode="contain"
                  />
                </View>
              )}

              {/* Product Info */}
              <Text variant="titleLarge" style={styles.modalTitle} numberOfLines={3}>
                {selectedProduct.name}
              </Text>

              {selectedProduct.current_price != null && (
                <Text variant="headlineMedium" style={[styles.modalPrice, { color: theme.colors.primary }]}>
                  ${selectedProduct.current_price.toFixed(2)}
                </Text>
              )}

              {selectedProduct.url && (
                <Text variant="bodySmall" style={[styles.modalHostname, { color: theme.colors.onSurfaceVariant }]}>
                  {(() => {
                    try {
                      return new URL(selectedProduct.url).hostname.replace('www.', '');
                    } catch {
                      return '';
                    }
                  })()}
                </Text>
              )}

              {/* Price History Chart */}
              <View style={styles.priceHistorySection}>
                <Text variant="titleSmall" style={{ marginBottom: 8 }}>
                  Price History
                </Text>
                <PriceHistoryChart
                  productId={selectedProduct.id}
                  targetPrice={selectedProduct.target_price}
                  currentPrice={selectedProduct.current_price}
                />
              </View>

              {/* Claim Status Badge */}
              {/* Never reveal the claimer's identity on the owner's own list — it spoils the surprise. */}
              {isProductClaimed && (
                <View style={[styles.claimedBadge, { backgroundColor: theme.colors.primaryContainer }]}>
                  <Text variant="labelMedium" style={{ color: theme.colors.onPrimaryContainer }}>
                    ✓ Claimed
                  </Text>
                </View>
              )}

              {/* Action Buttons */}
              <View style={styles.modalActions}>
                {/* Claim Button - only show if not already claimed and user is logged in */}
                {!isProductClaimed && user && (
                  <Button
                    mode="contained"
                    icon="gift"
                    onPress={handleClaimProduct}
                    loading={isClaiming}
                    disabled={isClaiming}
                    style={styles.actionButton}
                    contentStyle={styles.actionButtonContent}
                  >
                    Mark as Claimed
                  </Button>
                )}

                {selectedProduct.url && (
                  <Button
                    mode={isProductClaimed ? 'contained' : 'outlined'}
                    icon="open-in-new"
                    onPress={handleOpenUrl}
                    style={styles.actionButton}
                    contentStyle={styles.actionButtonContent}
                  >
                    Open in Browser
                  </Button>
                )}

                <Button
                  mode="text"
                  onPress={() => setProductModalVisible(false)}
                  style={styles.closeButton}
                >
                  Close
                </Button>
              </View>
            </View>
          )}
        </Modal>
      </Portal>

      {/* Share List Modal */}
      <Portal>
        <Modal
          visible={shareModalVisible}
          onDismiss={() => setShareModalVisible(false)}
          contentContainerStyle={[styles.shareModalContainer, { backgroundColor: theme.colors.surface }]}
        >
          <View style={styles.shareModalContent}>
            <Text variant="titleLarge" style={styles.shareModalTitle}>
              Share List
            </Text>

            {listData?.share_code || listData?.access_code ? (
              <>
                <Text variant="bodyMedium" style={[styles.shareDescription, { color: theme.colors.onSurfaceVariant }]}>
                  Share this code with friends so they can view your wishlist
                </Text>

                <Surface style={[styles.shareCodeBox, { backgroundColor: theme.colors.primaryContainer }]} elevation={0}>
                  <Text variant="headlineMedium" style={[styles.shareCodeText, { color: theme.colors.onPrimaryContainer }]}>
                    {listData?.share_code || listData?.access_code}
                  </Text>
                </Surface>

                <View style={styles.shareActions}>
                  <Button
                    mode="contained"
                    icon="share"
                    onPress={handleShareList}
                    style={styles.shareMainButton}
                    contentStyle={styles.actionButtonContent}
                  >
                    Share Link
                  </Button>

                  <View style={styles.shareRow}>
                    <Button
                      mode="outlined"
                      icon="content-copy"
                      onPress={handleCopyShareCode}
                      style={styles.shareHalfButton}
                      contentStyle={styles.halfButtonContent}
                      labelStyle={styles.halfButtonLabel}
                    >
                      Copy Code
                    </Button>
                    <Button
                      mode="outlined"
                      icon="link"
                      onPress={handleCopyShareLink}
                      style={styles.shareHalfButton}
                      contentStyle={styles.halfButtonContent}
                      labelStyle={styles.halfButtonLabel}
                    >
                      Copy Link
                    </Button>
                  </View>
                </View>
              </>
            ) : (
              <>
                <Text variant="bodyMedium" style={[styles.shareDescription, { color: theme.colors.onSurfaceVariant }]}>
                  This list is private. Make it public to share with others.
                </Text>
                <Button
                  mode="contained"
                  onPress={() => {
                    setShareModalVisible(false);
                    navigation.navigate('EditList', { listId });
                  }}
                  style={styles.shareMainButton}
                  contentStyle={styles.actionButtonContent}
                >
                  Edit List Settings
                </Button>
              </>
            )}

            <Button
              mode="text"
              onPress={() => setShareModalVisible(false)}
              style={styles.shareCloseButton}
            >
              Close
            </Button>
          </View>
        </Modal>
      </Portal>

      {/* Add Product FAB */}
      <FAB.Group
        open={addMenuVisible}
        visible
        icon={addMenuVisible ? 'close' : 'plus'}
        actions={[
          {
            icon: 'barcode-scan',
            label: 'Scan Barcode',
            onPress: () => navigation.navigate('ScanProduct', { listId }),
          },
          {
            icon: 'pencil',
            label: 'Add Manually',
            onPress: () => navigation.navigate('AddProduct', { listId }),
          },
        ]}
        onStateChange={({ open }) => setAddMenuVisible(open)}
        fabStyle={{ backgroundColor: theme.colors.primary }}
        color={theme.colors.onPrimary}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  listContent: {
    padding: 16,
  },
  headerButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: -8,
  },

  // Product Modal Styles
  modalContainer: {
    marginHorizontal: 24,
    borderRadius: 16,
    maxHeight: '85%',
  },
  modalContent: {
    padding: 20,
  },
  modalImageContainer: {
    width: '100%',
    height: 180,
    backgroundColor: colors.surfaceLight,
    borderRadius: 12,
    marginBottom: 16,
    overflow: 'hidden',
  },
  modalImage: {
    width: '100%',
    height: '100%',
  },
  modalTitle: {
    marginBottom: 8,
    lineHeight: 28,
  },
  modalPrice: {
    fontWeight: '600',
    marginBottom: 4,
  },
  modalHostname: {
    marginBottom: 12,
  },
  priceHistorySection: {
    marginBottom: 16,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#E0E0E0',
  },
  claimedBadge: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginBottom: 16,
    alignSelf: 'flex-start',
  },
  modalActions: {
    marginTop: 8,
  },
  actionButton: {
    marginBottom: 10,
    borderRadius: 8,
  },
  actionButtonContent: {
    paddingVertical: 6,
  },
  closeButton: {
    marginTop: 4,
  },

  // Share Modal Styles
  shareModalContainer: {
    marginHorizontal: 24,
    borderRadius: 16,
  },
  shareModalContent: {
    padding: 24,
  },
  shareModalTitle: {
    marginBottom: 12,
    fontWeight: '600',
  },
  shareDescription: {
    marginBottom: 20,
    lineHeight: 20,
  },
  shareCodeBox: {
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 20,
  },
  shareCodeText: {
    fontWeight: '700',
    letterSpacing: 3,
  },
  shareActions: {
    gap: 10,
  },
  shareMainButton: {
    borderRadius: 8,
    marginBottom: 6,
  },
  shareRow: {
    flexDirection: 'row',
    gap: 10,
  },
  shareHalfButton: {
    flex: 1,
    borderRadius: 8,
  },
  halfButtonContent: {
    paddingVertical: 2,
  },
  halfButtonLabel: {
    fontSize: 13,
  },
  shareCloseButton: {
    marginTop: 12,
  },
});
