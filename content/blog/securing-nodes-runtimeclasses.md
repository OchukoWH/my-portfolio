---
title: "Hardening Kubernetes Nodes: Sandboxing Containers with gVisor & RuntimeClasses"
description: "Learn how to improve Kubernetes workload isolation using gVisor and RuntimeClasses. Understand how containers interact with the Linux kernel, why shared kernels are a security concern, and how to run sandboxed workloads with minimal overhead."
date: "2026-07-11"
tags: "Kubernetes, gVisor, RuntimeClass, Container Security, Linux, containerd, Platform Engineering, Cloud Native"
published: true
order: 1
---

Containerization has transformed how we run applications. On a single server, we can host multiple isolated services, and with Kubernetes, we can scale this even further by orchestrating containers across multiple nodes. This model is efficient, fast, and ideal for most workloads, but it also comes with a serious security concern.

Because containers typically share the host's kernel, a single container escape or kernel exploit can compromise an entire node.

In this article, we'll explore how **gVisor** helps mitigate this risk through a lightweight userspace kernel that sandboxes workloads at the syscall level. We'll break down how gVisor works, when to use it, and how to integrate it into your cluster using **RuntimeClass**, giving your workloads stronger isolation without requiring a major architectural change.


## 1. Setting Up the Cluster

To follow along with this article, you'll need a Kubernetes lab.

The lab uses **Vagrant** to bootstrap a single-node kubeadm cluster inside a 4 GB Ubuntu virtual machine. You'll need:

- Vagrant
- VirtualBox
- At least **8 GB** of available RAM

The cluster installs:

- Kubernetes via kubeadm
- containerd
- Calico as the CNI
- An untainted control-plane node so workloads can be scheduled

You can provision the entire environment using the setup script below.

```bash
curl -s https://raw.githubusercontent.com/OchukoWH/one-node-kubeadm-cluster/refs/heads/main/scripts/setup-lab.sh | bash
```

After the installation completes:

```bash
cd one-node-kubeadm-cluster
vagrant ssh
```


## 2. What Happens When You Run a Container in Kubernetes

Suppose you create a Pod:

```bash
kubectl run mypod --image=nginx
```

Behind the scenes, several components work together to start the container.

At a high level:

1. The API server receives the request and stores the Pod object in etcd.
2. The scheduler selects a node.
3. The kubelet on that node detects the new Pod.
4. The kubelet communicates with the container runtime through the **Container Runtime Interface (CRI)**.
5. containerd pulls the image.
6. containerd creates namespaces, cgroups, mounts, and invokes the OCI runtime (`runc`).
7. `runc` configures the container environment and starts the main process (`nginx`).

Although containers appear isolated, there is one very important detail:

> **The container still uses the host's Linux kernel.**

Containers do **not** have their own kernel.

Instead, processes inside the container execute system calls directly against the host operating system.

This is what makes containers lightweight, but it is also the primary reason container escapes can be dangerous.


## Kernel Space vs User Space

To understand why this matters, let's briefly review how Linux is structured.

## User Space

User space is where applications run.

Examples include:

- nginx
- Python
- Go binaries
- Java applications

Applications cannot directly access hardware.

Whenever they need resources such as:

- files
- memory
- networking
- processes

they must make **system calls (syscalls)** to the kernel.


## Kernel Space

Kernel space is the privileged part of Linux.

It is responsible for:

- Process scheduling
- Memory management
- Filesystems
- Networking
- Device drivers
- Hardware access

Every container on the node shares this same kernel.

Whenever an application inside a container performs operations like:

- `open()`
- `read()`
- `write()`
- `socket()`

those syscalls are handled by the **host kernel**.

That shared kernel is the reason a successful kernel exploit inside one container can potentially compromise the host.


## Seeing the Shared Kernel

Let's prove that the container is actually using the host kernel.

Create a Pod:

```bash
kubectl run mypod --image=nginx
```

Enter the container:

```bash
kubectl exec -it mypod -- bash
```

Inside the container:

```bash
uname -r
```

You'll notice the kernel version matches the host machine.

You can also inspect:

```bash
cat /proc/version
```

```bash
cat /proc/sys/kernel/hostname
```

These values come directly from the host kernel.

Although namespaces isolate many resources, the kernel itself is still shared.


## 3. Securing the Shared Kernel

Since every container shares the host kernel, one of the best ways to improve security is to reduce how much of that kernel containers can interact with directly.

This is exactly what **gVisor** does.

Instead of allowing applications to issue syscalls directly to the Linux kernel, gVisor inserts another layer between the application and the host.

It implements a lightweight userspace kernel written in Go.

When applications make syscalls, they are intercepted by gVisor first.

The result is a sandbox that greatly limits direct interaction with the host kernel.

This dramatically reduces the impact of:

- Container escapes
- Kernel vulnerabilities
- Untrusted workloads
- Multi-tenant applications


## Installing gVisor

Install gVisor on your Kubernetes node using the setup script:

```bash
curl https://raw.githubusercontent.com/OchukoWH/setup-gvisor/refs/heads/main/setup-gvisor.sh | bash
```


## 4. Using RuntimeClasses

Installing gVisor alone does **not** automatically sandbox your Pods.

Kubernetes continues using the default runtime unless you explicitly tell it otherwise.

This is where **RuntimeClass** comes in.

A RuntimeClass is a Kubernetes resource that tells the kubelet which runtime handler should be used for a Pod.

Instead of using the default runtime (`runc`), Kubernetes can instruct containerd to use the `runsc` runtime provided by gVisor.

> **Important:** gVisor must be installed on every node where Pods using that RuntimeClass may be scheduled.

If Kubernetes schedules the Pod onto a node without gVisor installed, the Pod will fail to start.


## Create the RuntimeClass

```yaml
apiVersion: node.k8s.io/v1
kind: RuntimeClass
metadata:
  name: gvisor
handler: runsc
```

Apply it:

```bash
kubectl apply -f runtimeclass.yaml
```

Verify it exists:

```bash
kubectl get runtimeclass
```

Example output:

```text
NAME      HANDLER
gvisor    runsc
```


## Running a Pod with gVisor

Create the following Pod:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: myapp
spec:
  runtimeClassName: gvisor

  containers:
  - name: nginx-frontend
    image: nginx
```

Apply it:

```bash
kubectl apply -f pod.yaml
```


## 5. Inspecting the Sandbox

Enter the Pod:

```bash
kubectl exec -it myapp -- bash
```

Check the kernel version:

```bash
uname -r
```

Example:

```text
4.4.0
```

Notice something interesting.

The reported kernel version no longer matches the host kernel.

Instead, it is the virtualized kernel presented by gVisor.

You can also inspect:

```bash
cat /proc/version
```

Example:

```text
Linux version 4.4.0 #1 SMP Sun Jan 10 15:06:54 PST 2016
```

And:

```bash
cat /proc/sys/kernel/hostname
```

Example:

```text
myapp
```

Unlike ordinary containers, these values are no longer direct reflections of the host kernel.

Instead, they are provided through gVisor's userspace kernel implementation.


## Conclusion

gVisor provides an excellent balance between security and performance for Kubernetes workloads.

By inserting a lightweight userspace kernel between containers and the host operating system, it dramatically reduces the attack surface available to attackers. Even if an application inside the container is compromised, the workload has far less direct interaction with the host kernel, significantly reducing the blast radius of a successful exploit.

As Kubernetes clusters increasingly run workloads from multiple teams, customers, and even untrusted third parties, stronger runtime isolation is becoming a necessity rather than a luxury.

Unlike traditional virtual machines, gVisor delivers this additional protection without requiring hardware virtualization or the overhead of running a complete guest operating system.

If you're looking to harden your Kubernetes clusters while maintaining the speed and efficiency of containers, gVisor and RuntimeClasses provide a practical, production-ready solution.