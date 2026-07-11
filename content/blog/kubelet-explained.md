---
title: "Kubelet — The Backbone Behind Every Kubernetes Node"
description: "Learn how the Kubernetes kubelet works under the hood. Explore how it registers nodes, starts Pods, monitors node health, manages static Pods, communicates with container runtimes, and powers every Kubernetes cluster."
date: "2026-07-11"
tags: "Kubernetes, Kubelet, kubeadm, containerd, CRI, Platform Engineering, Cloud Native"
published: true
order: 3
---

Have you ever wondered what actually happens after you create a Pod? Or how the Kubernetes API server knows whether a node is healthy?

Although the API server is the central component of Kubernetes, it does **not** start containers, monitor nodes, or keep workloads running.

Those responsibilities belong to the **kubelet**.

The kubelet is one of the most important components in Kubernetes. Every workload that runs on a node ultimately depends on it. Without the kubelet, Kubernetes would simply be a collection of API objects stored in etcd—nothing would actually execute.

In this article, we'll explore how the kubelet works, how it communicates with the control plane, how it starts containers, and why it is often considered the backbone of every Kubernetes node.


## What is the Kubelet?

Every Kubernetes node requires two major components before it can run workloads:

- A **Container Runtime**, such as containerd or CRI-O
- The **kubelet**

The kubelet is a process that runs on every node, typically as a **systemd service**.

Its responsibilities include:

- Communicating with the Kubernetes API server
- Registering the node
- Monitoring node health
- Watching for assigned Pods
- Creating and restarting containers
- Executing health probes
- Reporting status back to the control plane

In short, the kubelet continuously works to ensure the actual state of the node matches Kubernetes' desired state.


## Monitoring Node Health

One of the kubelet's first responsibilities is monitoring the node on which it runs.

Every few seconds, it gathers information such as:

- CPU availability
- Memory availability
- Disk usage
- Filesystem capacity
- Process limits
- Network availability
- Container runtime health
- Kernel status
- Swap configuration

The kubelet periodically sends this information back to the API server by updating the **Node** object.

This is how Kubernetes determines whether a node is healthy enough to schedule workloads.


## Installing and Starting the Kubelet

On most Linux distributions, the kubelet is installed as a package.

Ubuntu:

```bash
apt install kubelet
```

RHEL/CentOS:

```bash
yum install kubelet
```

Because the kubelet runs as a systemd service, you can inspect its status with:

```bash
systemctl status kubelet
```

A typical kubelet service consists of:

```text
kubelet.service
├── kubelet binary
├── configuration
├── certificates
└── kubeconfig
```

Immediately after startup, the kubelet begins:

- Reading its configuration
- Discovering node resources
- Loading certificates
- Connecting to the API server
- Registering the node

A machine does **not** become part of a Kubernetes cluster until the kubelet successfully starts.


## Kubelet Configuration

Every kubelet reads configuration that defines how it behaves.

The configuration file is commonly located at:

```text
/var/lib/kubelet/config.yaml
```

Example:

```yaml
apiVersion: kubelet.config.k8s.io/v1beta1
kind: KubeletConfiguration

clusterDNS:
- 10.96.0.10

clusterDomain: cluster.local
```

Some of the most important settings include:

- `clusterDNS`
- `clusterDomain`
- `staticPodPath`
- `cgroupDriver`


## clusterDNS

This specifies the DNS server that Pods use for service discovery.

For example:

```bash
kubectl exec -it mygood -- cat /etc/resolv.conf
```

Example output:

```text
search default.svc.cluster.local svc.cluster.local cluster.local
nameserver 10.96.0.10
options ndots:5
```

Notice that the nameserver matches the ClusterDNS IP.

You can verify the ClusterDNS Service:

```bash
kubectl -n kube-system get svc kube-dns
```

Every Pod receives this DNS server automatically.


## clusterDomain

This specifies the DNS suffix used throughout the cluster.

Suppose you create:

```bash
kubectl create ns kubelet

kubectl -n kubelet run mynginx --image=nginx

kubectl -n kubelet expose pod mynginx \
  --port 80 \
  --name kube-svc

kubectl run mybusy \
  --image=busybox \
  -- sh -c "sleep infinity"
```

Now test DNS resolution:

```bash
kubectl exec -it mybusy -- \
wget --timeout=5 --spider \
kube-svc.kubelet.svc.cluster.local
```

Example output:

```text
Server:         10.96.0.10
Address:        10.96.0.10:53

Name: kube-svc.kubelet.svc.cluster.local
Address: 10.104.169.148
```

The DNS server resolves the fully qualified service name to the ClusterIP of the Service.


## staticPodPath

The kubelet continuously watches a directory containing **Static Pod** manifests.

Typically:

```text
/etc/kubernetes/manifests
```

Any Pod manifest placed inside this directory is started automatically.

This setting is particularly important on control-plane nodes because it is how Kubernetes bootstraps itself.


## cgroupDriver

The kubelet and the container runtime must use compatible cgroup drivers.

Supported options include:

- `systemd`
- `cgroupfs`

To verify containerd's configuration:

```bash
containerd config dump | grep SystemdCgroup
```

To modify it:

```bash
vim /etc/containerd/config.toml
```

After making changes:

```bash
systemctl restart containerd
```

A mismatch between the kubelet and the container runtime is a common source of cluster instability.


## How the Kubelet Registers a Node

Most worker nodes join a cluster using a command generated by:

```bash
kubeadm token create --print-join-command
```

Example:

```bash
sudo kubeadm join 10.0.0.10:6443 \
  --token abcdef.1234567890abcdef \
  --discovery-token-ca-cert-hash sha256:...
```

Behind the scenes, several things happen.

1. kubeadm authenticates using the bootstrap token.
2. kubeadm generates the kubelet configuration.
3. kubelet starts.
4. kubelet creates a Certificate Signing Request (CSR).
5. The API server approves the CSR.
6. kubelet receives a client certificate.
7. kubelet registers the node.

The process looks like this:

```text
kubeadm join
      │
      ▼
Bootstrap Authentication
      │
      ▼
Generate kubelet Configuration
      │
      ▼
Start kubelet
      │
      ▼
Create CSR
      │
      ▼
API Server
      │
      ▼
Certificate Approved
      │
      ▼
kubelet.conf Updated
      │
      ▼
Register Node
```

After registration, the kubelet authenticates as the node itself.

For example:

```bash
kubectl \
--kubeconfig /etc/kubernetes/kubelet.conf \
auth whoami
```

Example:

```text
Username: system:node:worker1

Groups:
system:nodes
system:authenticated
```

You can verify registered nodes from the control plane:

```bash
kubectl get nodes
```

Example:

```text
NAME      STATUS   ROLES
master    Ready    control-plane
worker1   Ready    <none>
```


## How the Kubelet Watches for Pods

Once registered, the kubelet begins watching the API server for Pods assigned to its node.

Suppose the scheduler assigns a Pod:

```yaml
spec:
  nodeName: worker1
```

The kubelet running on **worker1** notices that assignment.

It retrieves the Pod specification.

Example:

```yaml
containers:
- name: nginx
  image: nginx
```

The kubelet then enters its reconciliation loop.

```text
Pod exists?
      │
     No
      ▼
Create Pod

Container running?
      │
     No
      ▼
Start Container

Container healthy?
      │
     No
      ▼
Restart Container
```

This loop never stops.

The kubelet continuously compares the desired state with reality and takes corrective action whenever necessary.


## Static Pods

Static Pods are managed directly by the kubelet instead of the API server.

Rather than retrieving Pod definitions from Kubernetes, the kubelet watches the directory specified by `staticPodPath`.

Usually:

```text
/etc/kubernetes/manifests
```

Suppose you place the following file there:

```yaml
apiVersion: v1
kind: Pod

metadata:
  name: nginx
```

The kubelet immediately detects the new manifest and starts the Pod.

```text
Manifest Created
       │
       ▼
Kubelet Detects File
       │
       ▼
Container Created
```

No scheduler is involved.

No Deployment is required.

The API server does not initiate the process.

Static Pods are the mechanism Kubernetes uses to bootstrap its own control plane.

Notice that control-plane Static Pods include the node name in their Pod names.

Example:

```text
etcd-cluster3
kube-apiserver-cluster3
kube-controller-manager-cluster3
kube-scheduler-cluster3
```


## How the Kubernetes Control Plane Starts

One of the most fascinating aspects of Kubernetes is that the control plane itself depends on the kubelet.

When you execute:

```bash
kubeadm init
```

kubeadm does **not** directly start:

- kube-apiserver
- kube-controller-manager
- kube-scheduler
- etcd

Instead, it writes manifest files into:

```text
/etc/kubernetes/manifests
```

Example:

```text
kube-apiserver.yaml
kube-controller-manager.yaml
kube-scheduler.yaml
etcd.yaml
```

The kubelet watches this directory.

As soon as it detects those files, it starts the containers.

The startup sequence looks like this:

```text
Kubelet Starts
      │
      ▼
Reads Static Pod Files
      │
      ▼
Starts API Server
      │
      ▼
API Server Becomes Available
      │
      ▼
Cluster Begins Operating
```

Without the kubelet, the Kubernetes control plane would never start.


## Common Kubelet Failure Scenarios

Understanding kubelet failures makes troubleshooting Kubernetes significantly easier.


## Kubelet Stops

```bash
systemctl stop kubelet
```

Effects:

- Existing containers continue running.
- New Pods cannot start.
- The node eventually becomes **NotReady**.


## API Server Failure

If the API server becomes unavailable:

- Existing Pods continue running.
- No new workloads are scheduled.
- Cluster state cannot be updated.


## Container Runtime Failure

If containerd crashes:

```text
Kubelet
   │
   ▼
Container Runtime Unavailable
```

Effects:

- New containers cannot start.
- Container restarts fail.
- Pod lifecycle management stops.


## Certificate Expiration

If kubelet certificates expire:

- Authentication fails.
- Heartbeats stop.
- The node becomes unreachable.


## Swap Enabled

Many Kubernetes installations require swap to be disabled.

Check:

```bash
swapon --show
```

Typical error:

```text
running with swap on is not supported
```

Disable swap:

```bash
swapoff -a
```

For permanent changes, remove swap entries from `/etc/fstab`.


## Cgroup Driver Mismatch

Example:

```text
Kubelet:
systemd

containerd:
cgroupfs
```

Possible effects:

- Kubelet startup failures
- Pod creation failures
- Nodes repeatedly transitioning between Ready and NotReady


## Missing Sysctl Settings

Kubernetes networking depends on kernel parameters such as:

```bash
net.bridge.bridge-nf-call-iptables

net.ipv4.ip_forward
```

Configure them:

```bash
cat <<EOF >/etc/sysctl.d/k8s.conf
net.bridge.bridge-nf-call-iptables = 1
net.ipv4.ip_forward = 1
EOF

sysctl -p /etc/sysctl.d/k8s.conf
```


## Troubleshooting the Kubelet

The first place to investigate kubelet issues is the systemd journal.

View logs:

```bash
journalctl -u kubelet
```

Follow logs in real time:

```bash
journalctl -u kubelet -f
```

Common errors include:

```text
running with swap on is not supported

failed to run Kubelet

failed to validate cgroup driver

certificate has expired

container runtime is down
```

When a node unexpectedly becomes **NotReady**, the kubelet journal is often the quickest way to identify the underlying problem.


## Conclusion

The kubelet is frequently described as a *node agent*, but that description hardly captures its importance.

The kubelet is responsible for:

- Registering nodes
- Reporting node health
- Creating Pods
- Restarting containers
- Executing probes
- Mounting volumes
- Communicating with the container runtime
- Bootstrapping the Kubernetes control plane itself

Without the kubelet, Kubernetes would simply be a collection of objects stored in etcd.

Nothing would actually run.

The next time you deploy an application and watch a Pod transition from **Pending** to **Running**, remember what really happened:

The scheduler decided where the Pod should run.

The API server stored that decision.

**But it was the kubelet that turned that desired state into a running container.**